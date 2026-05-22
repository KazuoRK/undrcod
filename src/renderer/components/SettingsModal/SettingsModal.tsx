/**
 * SettingsModal — painel de configurações estilo Cursor Settings.
 *
 * Layout:
 *   - Header sticky no topo (title + search global + close)
 *   - Sidebar esquerda fina (200px) com lista de sections
 *   - Body com scroll independente; cada section tem h1 + grupos + rows
 *
 * Search: o input no header filtra TODAS as sections simultaneamente. Cada
 * SettingRow recebe o predicate `searchQuery` via context; se nem label nem
 * helper batem, a row se esconde. Grupos vazios também colapsam.
 *
 * Settings persistidas em electron-store via window.undrcodAPI?.settings.
 *
 * Sections (ordem da sidebar):
 *   - Geral (theme, font scale, zoom, sounds, memory monitor)
 *   - Chat (modo default, effort default, idioma, font size, thinking, auto-scroll)
 *   - Editor (font size, tab width, word wrap, format on save, minimap, ...)
 *   - Atalhos (lista hardcoded + reset visual)
 *   - Sobre (versão, links pra docs/github)
 *
 * Defensive: se window.undrcodAPI?.settings não existe (preload velho/build antigo),
 * mostra mensagem instruindo restart.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import {
  DEFAULT_SETTINGS,
  SHORTCUTS_REFERENCE,
  type ChatEffort,
  type ChatFontSize,
  type ChatMode,
  type PreferredLanguage,
  type ThemeMode,
  type UndrSettings,
} from '../../../shared/settings-types';
import { playSound, setAudioEnabled } from '../../utils/audioFeedback';
import { toast } from '../Toast/Toast';
import { confirmDialog } from '../ConfirmDialog/ConfirmDialog';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

type SectionId = 'geral' | 'chat' | 'editor' | 'atalhos' | 'sobre';

const SECTIONS: Array<{ id: SectionId; label: string; icon: string }> = [
  { id: 'geral', label: 'Geral', icon: 'settings-gear' },
  { id: 'chat', label: 'Chat', icon: 'comment-discussion' },
  { id: 'editor', label: 'Editor', icon: 'code' },
  { id: 'atalhos', label: 'Atalhos', icon: 'keyboard' },
  { id: 'sobre', label: 'Sobre', icon: 'info' },
];

// ----------------------------------------------------------------------------
// Search context
// ----------------------------------------------------------------------------
// Em vez de prop-drillar `searchQuery` em cada section/row, usamos context.
// Cada SettingRow consulta `useSearchMatch(label, helper)` e se esconde se
// não bate. Grupos contam quantas rows visíveis têm via callback registered.

interface SearchContextValue {
  query: string;
  /** Retorna true se label OR helper batem com query (ou query vazia). */
  matches: (label: string, helper?: string) => boolean;
}

const SearchContext = createContext<SearchContextValue>({
  query: '',
  matches: () => true,
});

function useSearch() {
  return useContext(SearchContext);
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SectionId>('geral');
  const [settings, setSettings] = useState<UndrSettings | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Detecta se a API está disponível (defensive: preload velho)
  useEffect(() => {
    if (!open) return;
    const api = window.undrcodAPI?.settings;
    if (!api || typeof api.all !== 'function') {
      setAvailable(false);
      return;
    }
    setAvailable(true);
    api.all().then((all) => {
      if (all) setSettings(all);
      else setSettings({ ...DEFAULT_SETTINGS });
    }).catch(() => {
      setSettings({ ...DEFAULT_SETTINGS });
    });
  }, [open]);

  // Reset state ao fechar (não acumula query/section entre aberturas)
  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setActiveSection('geral');
    }
  }, [open]);

  // Autofocus search ao abrir
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(id);
  }, [open]);

  // Listener pra mudanças vindas de outro lugar (ex: outro modal, ou reset)
  useEffect(() => {
    if (!open || !available) return;
    const api = window.undrcodAPI?.settings;
    if (!api) return;
    const offChanged = api.onChanged?.((key, value) => {
      setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    });
    const offReset = api.onResetAll?.((snapshot) => {
      setSettings({ ...snapshot });
    });
    return () => {
      offChanged?.();
      offReset?.();
    };
  }, [open, available]);

  // Esc fecha
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Helper pra atualizar uma setting (otimista + IPC).
  const update = useCallback(<K extends keyof UndrSettings,>(key: K, value: UndrSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    // Side effect imediato pra audioEnabled: sincroniza o helper de feedback
    if (key === 'audioEnabled' && typeof value === 'boolean') {
      setAudioEnabled(value);
      if (value) playSound('notification');
    }
    const api = window.undrcodAPI?.settings;
    if (!api) return;
    api.set(key, value).then((res) => {
      if (res.ok === false) {
        console.warn('[settings] set falhou:', res.error);
      } else if (res.value !== value) {
        setSettings((prev) => (prev ? { ...prev, [key]: res.value } : prev));
      }
    });
  }, []);

  const handleResetAll = useCallback(() => {
    const api = window.undrcodAPI?.settings;
    if (!api) return;
    api.reset().then((res) => {
      if (res.ok && 'snapshot' in res && res.snapshot) {
        setSettings({ ...res.snapshot });
      }
    });
  }, []);

  const handleExportSettings = useCallback(() => {
    const api = window.undrcodAPI?.settings;
    if (!api) return;
    api.all().then((all) => {
      try {
        const json = JSON.stringify(all ?? {}, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'undrcode-settings.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success('Configurações exportadas');
      } catch (err) {
        console.error('[settings] export falhou:', err);
        toast.error('Falha ao exportar configurações');
      }
    }).catch((err) => {
      console.error('[settings] export falhou:', err);
      toast.error('Falha ao exportar configurações');
    });
  }, []);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    void (async () => {
      const ok = await confirmDialog({
        title: 'Importar configurações',
        message: `Isso vai sobrescrever as configurações atuais com o conteúdo de "${file.name}". Continuar?`,
        confirmLabel: 'Importar',
        destructive: true,
      });
      if (!ok) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result ?? '');
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            toast.error('Arquivo inválido — esperado objeto JSON');
            return;
          }
          let count = 0;
          for (const [key, value] of Object.entries(parsed)) {
            update(key as keyof UndrSettings, value as UndrSettings[keyof UndrSettings]);
            count++;
          }
          toast.success(`${count} configurações importadas`);
        } catch (err) {
          console.error('[settings] import parse falhou:', err);
          toast.error('Falha ao ler JSON');
        }
      };
      reader.onerror = () => {
        toast.error('Falha ao ler arquivo');
      };
      reader.readAsText(file);
    })();
  }, [update]);

  const handleImportFromVSCode = useCallback(() => {
    const api = window.undrcodAPI?.settings as unknown as
      | {
          importFromVSCode?: () => Promise<
            | { ok: true; source: string; imported: Partial<UndrSettings> }
            | { ok: false; error: string }
          >;
        }
      | undefined;
    if (!api || typeof api.importFromVSCode !== 'function') {
      toast.error('Importação não disponível — reinicie o app pra atualizar o preload');
      return;
    }
    void (async () => {
      const ok = await confirmDialog({
        title: 'Importar do VS Code',
        message:
          'Vou procurar settings.json do VS Code no seu sistema e copiar as configurações compatíveis (fonte, tab size, word wrap, format on save/paste, auto-save, sticky scroll, zoom...). As suas atuais serão sobrescritas pros campos importados. Continuar?',
        confirmLabel: 'Importar',
        destructive: true,
      });
      if (!ok) return;

      const res = await api.importFromVSCode!();
      if (res.ok === false) {
        toast.error(`Falha: ${res.error}`);
        return;
      }
      const entries = Object.entries(res.imported);
      if (entries.length === 0) {
        toast.info('Nenhuma configuração compatível encontrada no VS Code');
        return;
      }
      for (const [key, value] of entries) {
        update(key as keyof UndrSettings, value as UndrSettings[keyof UndrSettings]);
      }
      toast.success(`${entries.length} configurações importadas do VS Code`);
    })();
  }, [update]);

  const handleResetShortcuts = useCallback(() => {
    // Atalhos são hardcoded por enquanto — "restaurar" é no-op visual.
    console.log('[settings] reset shortcuts (no-op por enquanto, hardcoded)');
  }, []);

  // Search predicate: case-insensitive substring match em label OR helper.
  // Query vazia = sempre true.
  const searchValue = useMemo<SearchContextValue>(() => {
    const q = searchQuery.trim().toLowerCase();
    const matches = (label: string, helper?: string) => {
      if (!q) return true;
      if (label.toLowerCase().includes(q)) return true;
      if (helper && helper.toLowerCase().includes(q)) return true;
      return false;
    };
    return { query: q, matches };
  }, [searchQuery]);

  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Configurações"
      >
        <div className="settings-header">
          <span className="settings-title">Configurações</span>
          <div className="settings-search">
            <i className="codicon codicon-search settings-search-icon" aria-hidden />
            <input
              ref={searchInputRef}
              type="text"
              className="settings-search-input"
              placeholder="Buscar configurações"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Buscar configurações"
            />
            {searchQuery && (
              <button
                type="button"
                className="settings-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Limpar busca"
                title="Limpar"
              >
                <i className="codicon codicon-close" aria-hidden />
              </button>
            )}
          </div>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            title="Fechar (Esc)"
            aria-label="Fechar"
          >
            <i className="codicon codicon-close" />
          </button>
        </div>

        {available === false ? (
          <div className="settings-unavailable">
            <i className="codicon codicon-warning settings-unavailable-icon" />
            <div className="settings-unavailable-title">Configurações não disponíveis</div>
            <div className="settings-unavailable-msg">
              A ponte de configurações não está carregada. Reinicie o app pra atualizar o preload.
            </div>
          </div>
        ) : (
          <div className="settings-body">
            <nav className="settings-sidebar" aria-label="Seções">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`settings-sidebar-item ${activeSection === s.id ? 'is-active' : ''}`}
                  onClick={() => setActiveSection(s.id)}
                >
                  <i className={`codicon codicon-${s.icon}`} aria-hidden />
                  <span>{s.label}</span>
                </button>
              ))}
            </nav>

            <div className="settings-content">
              {!settings ? (
                <div className="settings-loading">Carregando configurações...</div>
              ) : (
                <SearchContext.Provider value={searchValue}>
                  {activeSection === 'geral' && (
                    <GeralSection settings={settings} update={update} />
                  )}
                  {activeSection === 'chat' && (
                    <ChatSection settings={settings} update={update} />
                  )}
                  {activeSection === 'editor' && (
                    <EditorSection settings={settings} update={update} />
                  )}
                  {activeSection === 'atalhos' && (
                    <AtalhosSection onResetShortcuts={handleResetShortcuts} />
                  )}
                  {activeSection === 'sobre' && <SobreSection />}
                </SearchContext.Provider>
              )}
            </div>
          </div>
        )}

        <div className="settings-footer">
          <span className="settings-footer-hint">Armazenado em electron-store</span>
          <div className="settings-footer-actions">
            {available !== false && (
              <>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={handleImportFile}
                />
                <button
                  type="button"
                  className="settings-btn settings-btn-ghost"
                  onClick={handleExportSettings}
                  title="Salva todas as configurações atuais num arquivo JSON"
                >
                  Exportar
                </button>
                <button
                  type="button"
                  className="settings-btn settings-btn-ghost"
                  onClick={handleImportClick}
                  title="Carrega configurações de um arquivo JSON (sobrescreve as atuais)"
                >
                  Importar
                </button>
                <button
                  type="button"
                  className="settings-btn settings-btn-ghost"
                  onClick={handleImportFromVSCode}
                  title="Detecta o settings.json do VS Code instalado e importa os campos compatíveis"
                >
                  Importar do VS Code
                </button>
                <button
                  type="button"
                  className="settings-btn settings-btn-ghost"
                  onClick={handleResetAll}
                  title="Volta todas as configurações pros valores padrão"
                >
                  Restaurar padrão
                </button>
              </>
            )}
            <button type="button" className="settings-btn" onClick={onClose}>
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sections
// ============================================================================

interface SectionProps {
  settings: UndrSettings;
  update: <K extends keyof UndrSettings>(key: K, value: UndrSettings[K]) => void;
}

function GeralSection({ settings, update }: SectionProps) {
  return (
    <Section title="Geral">
      <Group title="Aparência">
        <SettingRow
          label="Idioma das respostas"
          helper="Em 'Automático' detecta o idioma do prompt e força pt-BR quando aplicável. Force pt-BR ou inglês pra sobrescrever."
        >
          <Select<PreferredLanguage>
            value={settings.preferredLanguage}
            onChange={(v) => update('preferredLanguage', v)}
            options={[
              { value: 'auto', label: 'Automático (detecta pelo prompt)' },
              { value: 'pt-BR', label: 'Português (Brasil)' },
              { value: 'en', label: 'English' },
            ]}
          />
        </SettingRow>

        <SettingRow
          label="Tema"
          helper="Esquema de cores do app — UNDRCOD (único)"
        >
          <ThemePicker
            value={settings.theme}
            onChange={(v) => update('theme', v)}
          />
        </SettingRow>

        <SettingRow
          label="Fator de zoom"
          helper={`Aplicado à janela inteira. Atual: ${settings.zoomFactor.toFixed(2)}x`}
        >
          <div className="settings-slider-row">
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.05}
              value={settings.zoomFactor}
              onChange={(e) => update('zoomFactor', parseFloat(e.target.value))}
              className="settings-slider"
              aria-label="Fator de zoom"
            />
            <span className="settings-slider-value">{settings.zoomFactor.toFixed(2)}x</span>
          </div>
        </SettingRow>

        <SettingRow
          label="Tamanho da fonte do chat"
          helper="Tamanho do texto na transcrição da conversa"
        >
          <SegmentedControl<ChatFontSize>
            value={settings.chatFontSize}
            onChange={(v) => update('chatFontSize', v)}
            options={[
              { value: 'sm', label: 'Pequena' },
              { value: 'md', label: 'Média' },
              { value: 'lg', label: 'Grande' },
            ]}
          />
        </SettingRow>
      </Group>

      <Group title="Feedback">
        <SettingRow
          label="Som de feedback do agente"
          helper="Sons sutis quando o assistente usa ferramentas ou responde"
        >
          <Toggle
            value={settings.audioEnabled}
            onChange={(v) => update('audioEnabled', v)}
          />
        </SettingRow>

        <SettingRow
          label="Monitor de memória na status bar"
          helper="Mostra uso de RAM e CPU do app no rodapé (polling 2s)"
        >
          <Toggle
            value={settings.showMemoryMonitor}
            onChange={(v) => update('showMemoryMonitor', v)}
          />
        </SettingRow>

        <SettingRow
          label="Mostrar status bar"
          helper="Exibe a barra de status no rodapé do app"
        >
          <Toggle
            value={settings.showStatusBar}
            onChange={(v) => update('showStatusBar', v)}
          />
        </SettingRow>
      </Group>

      <Group title="Workspace">
        <SettingRow
          label="Número máximo de workspaces recentes"
          helper={`Limite da lista de workspaces recentes. Atual: ${settings.recentWorkspacesMax}`}
        >
          <div className="settings-slider-row">
            <input
              type="range"
              min={5}
              max={50}
              step={1}
              value={settings.recentWorkspacesMax}
              onChange={(e) => update('recentWorkspacesMax', parseInt(e.target.value, 10))}
              className="settings-slider"
              aria-label="Máximo de workspaces recentes"
            />
            <span className="settings-slider-value">{settings.recentWorkspacesMax}</span>
          </div>
        </SettingRow>

        <SettingRow
          label="Detectar dev server automaticamente"
          helper="Tenta descobrir a URL do dev server (Vite/Next) ao abrir o preview"
        >
          <Toggle
            value={settings.autoDetectDevServer}
            onChange={(v) => update('autoDetectDevServer', v)}
          />
        </SettingRow>
      </Group>
    </Section>
  );
}

function ChatSection({ settings, update }: SectionProps) {
  return (
    <Section title="Chat">
      <Group title="Comportamento padrão">
        <SettingRow
          label="Modo padrão em nova sessão"
          helper="Define o modo do Claude ao abrir um chat novo"
        >
          <Select<ChatMode>
            value={settings.defaultChatMode}
            onChange={(v) => update('defaultChatMode', v)}
            options={[
              { value: 'default', label: 'Default (edição livre)' },
              { value: 'plan', label: 'Plan (só planejamento)' },
              { value: 'acceptEdits', label: 'Accept Edits (auto-aceita)' },
            ]}
          />
        </SettingRow>

        <SettingRow
          label="Effort padrão"
          helper="Quanto o Claude pensa antes de responder"
        >
          <Select<ChatEffort>
            value={settings.defaultEffort}
            onChange={(v) => update('defaultEffort', v)}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'xhigh', label: 'Extra High' },
              { value: 'max', label: 'Max' },
            ]}
          />
        </SettingRow>
      </Group>

      <Group title="Transcrição">
        <SettingRow
          label="Mostrar blocos de raciocínio"
          helper="Exibe os blocos de thinking do Claude na transcrição"
        >
          <Toggle
            value={settings.showThinkingBlocks}
            onChange={(v) => update('showThinkingBlocks', v)}
          />
        </SettingRow>

        <SettingRow
          label="Auto-rolar transcrição"
          helper="Rola pra última mensagem automaticamente quando ela chega"
        >
          <Toggle
            value={settings.autoScroll}
            onChange={(v) => update('autoScroll', v)}
          />
        </SettingRow>
      </Group>
    </Section>
  );
}

function EditorSection({ settings, update }: SectionProps) {
  return (
    <Section title="Editor">
      <Group title="Fonte e layout">
        <SettingRow
          label="Tamanho da fonte"
          helper={`Aplicado à visualização de arquivos. Atual: ${settings.editorFontSize}px`}
        >
          <div className="settings-slider-row">
            <input
              type="range"
              min={10}
              max={20}
              step={1}
              value={settings.editorFontSize}
              onChange={(e) => update('editorFontSize', parseInt(e.target.value, 10))}
              className="settings-slider"
              aria-label="Tamanho da fonte do editor"
            />
            <span className="settings-slider-value">{settings.editorFontSize}px</span>
          </div>
        </SettingRow>

        <SettingRow
          label="Largura da tabulação"
          helper="Quantos espaços a tecla Tab insere e quantas colunas o caractere tab ocupa. Não muda visual de arquivos com espaços literais — use Shift+Alt+F pra reformatar."
        >
          <SegmentedControl<2 | 4>
            value={settings.editorTabWidth as 2 | 4}
            onChange={(v) => update('editorTabWidth', v)}
            options={[
              { value: 2, label: '2' },
              { value: 4, label: '4' },
            ]}
          />
        </SettingRow>

        <SettingRow
          label="Detectar indentação do arquivo"
          helper="Quando ligado, Monaco infere o tabSize pelo conteúdo do arquivo aberto, ignorando a largura configurada acima."
        >
          <Toggle
            value={settings.editorDetectIndentation}
            onChange={(v) => update('editorDetectIndentation', v)}
          />
        </SettingRow>

        <SettingRow
          label="Quebra de linha"
          helper="Quebra linhas longas pra caber na largura visível"
        >
          <Toggle
            value={settings.editorWordWrap}
            onChange={(v) => update('editorWordWrap', v)}
          />
        </SettingRow>
      </Group>

      <Group title="Salvamento">
        <SettingRow
          label="Auto-save"
          helper="Quando salvar automaticamente arquivos editados. 'Após delay' espera sem digitar; 'Ao trocar foco' salva quando muda de aba."
        >
          <SegmentedControl<'off' | 'afterDelay' | 'onFocusChange'>
            value={settings.autoSave}
            onChange={(v) => update('autoSave', v)}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'afterDelay', label: 'Após delay' },
              { value: 'onFocusChange', label: 'Ao trocar foco' },
            ]}
          />
        </SettingRow>

        {settings.autoSave === 'afterDelay' && (
          <SettingRow
            label="Delay do auto-save"
            helper={`Tempo de espera antes de salvar. Atual: ${settings.autoSaveDelay}ms`}
          >
            <div className="settings-slider-row">
              <input
                type="range"
                min={500}
                max={5000}
                step={250}
                value={settings.autoSaveDelay}
                onChange={(e) => update('autoSaveDelay', parseInt(e.target.value, 10))}
                className="settings-slider"
                aria-label="Delay do auto-save"
              />
              <span className="settings-slider-value">{settings.autoSaveDelay}ms</span>
            </div>
          </SettingRow>
        )}

        <SettingRow
          label="Formatar ao salvar"
          helper="Aplica formatação automática do Monaco antes de salvar (Shift+Alt+F manual)"
        >
          <Toggle
            value={settings.formatOnSave}
            onChange={(v) => update('formatOnSave', v)}
          />
        </SettingRow>

        <SettingRow
          label="Formatar ao colar"
          helper="Aplica formatação automática no trecho colado"
        >
          <Toggle
            value={settings.formatOnPaste}
            onChange={(v) => update('formatOnPaste', v)}
          />
        </SettingRow>
      </Group>

      <Group title="Apresentação">
        <SettingRow
          label="Colorir pares de brackets"
          helper="Coloração distinta por nível de aninhamento — facilita ver onde abre e fecha"
        >
          <Toggle
            value={settings.bracketPairColorization}
            onChange={(v) => update('bracketPairColorization', v)}
          />
        </SettingRow>

        <SettingRow
          label="Sticky scroll"
          helper="Mantém scope (função/class) visível no topo ao scrollar dentro de blocos longos"
        >
          <Toggle
            value={settings.stickyScroll}
            onChange={(v) => update('stickyScroll', v)}
          />
        </SettingRow>

        <SettingRow
          label="Cursor suave"
          helper="Anima o movimento do caret ao mover entre posições"
        >
          <Toggle
            value={settings.smoothCaret}
            onChange={(v) => update('smoothCaret', v)}
          />
        </SettingRow>

        <SettingRow
          label="Mostrar minimap"
          helper="Overview lateral do arquivo. Útil em arquivos longos, pode poluir em telas pequenas."
        >
          <Toggle
            value={settings.editorMinimap}
            onChange={(v) => update('editorMinimap', v)}
          />
        </SettingRow>

        <SettingRow
          label="Mostrar números de linha"
          helper="Exibe a gutter de numeração à esquerda"
        >
          <Toggle
            value={settings.editorLineNumbers}
            onChange={(v) => update('editorLineNumbers', v)}
          />
        </SettingRow>

        <SettingRow
          label="Renderizar whitespace"
          helper="Mostra caracteres de espaço e tab no editor — útil pra detectar tabs vs spaces"
        >
          <Toggle
            value={settings.editorRenderWhitespace}
            onChange={(v) => update('editorRenderWhitespace', v)}
          />
        </SettingRow>

        <SettingRow
          label="Renderizar caracteres de controle"
          helper="Mostra caracteres invisíveis de controle"
        >
          <Toggle
            value={settings.editorRenderControlChars}
            onChange={(v) => update('editorRenderControlChars', v)}
          />
        </SettingRow>
      </Group>
    </Section>
  );
}

function AtalhosSection({ onResetShortcuts }: { onResetShortcuts: () => void }) {
  const search = useSearch();
  // Filtra por label do shortcut OR teclas (concatenated)
  const filtered = useMemo(
    () => SHORTCUTS_REFERENCE.filter((s) => search.matches(s.label, s.keys.join(' '))),
    [search],
  );

  return (
    <Section
      title="Atalhos"
      action={
        <button
          type="button"
          className="settings-btn settings-btn-sm settings-btn-ghost"
          onClick={onResetShortcuts}
        >
          Restaurar padrão
        </button>
      }
    >
      <p className="settings-section-hint">
        Edição de atalhos será adicionada numa versão futura. Esta lista mostra os bindings ativos.
      </p>

      {filtered.length === 0 ? (
        <div className="settings-empty">Nenhum atalho corresponde à busca.</div>
      ) : (
        <div className="settings-shortcuts-list">
          {filtered.map((s) => (
            <div key={s.id} className="settings-shortcut-row">
              <span className="settings-shortcut-label">{s.label}</span>
              <span className="kbd-row">
                {s.keys.map((k, i) => (
                  <kbd key={i} className="kbd">{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function SobreSection() {
  const version = '0.0.1';
  return (
    <Section title="Sobre">
      <Group title="UNDRCOD">
        <SettingRow label="Versão" helper="Versão atual do app">
          <span className="settings-static-value">{version}</span>
        </SettingRow>

        <SettingRow
          label="Documentação"
          helper="Guia de uso, atalhos e arquitetura"
        >
          <a
            className="settings-link"
            href="https://github.com/undrcod/undrcod#readme"
            target="_blank"
            rel="noreferrer noopener"
          >
            Abrir docs
            <i className="codicon codicon-link-external" aria-hidden />
          </a>
        </SettingRow>

        <SettingRow
          label="Repositório"
          helper="Código-fonte e issues no GitHub"
        >
          <a
            className="settings-link"
            href="https://github.com/undrcod/undrcod"
            target="_blank"
            rel="noreferrer noopener"
          >
            github.com/undrcod/undrcod
            <i className="codicon codicon-link-external" aria-hidden />
          </a>
        </SettingRow>
      </Group>

      <Group title="Créditos">
        <SettingRow
          label="Construído por UNDRCOD"
          helper="UNDRCOD é um wrapper Electron + React sobre a CLI claude, inspirado em Antigravity e Cursor."
        >
          <span className="settings-static-value">© 2026</span>
        </SettingRow>
      </Group>
    </Section>
  );
}

// ============================================================================
// Layout helpers — Section / Group / SettingRow
// ============================================================================

/**
 * Section — h1 do topo da página + container. Aceita `action` opcional pro lado
 * direito do header (ex: botão "Restaurar padrão" na section Atalhos).
 */
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <h1 className="settings-section-title">{title}</h1>
        {action && <div className="settings-section-action">{action}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * Group — subseção dentro de uma section. Tem h3 UPPERCASE + lista de rows.
 * Se TODAS as rows filhas estiverem ocultas por search, o grupo inteiro
 * desaparece (incluindo o h3 e o divider). Implementado contando os children
 * visíveis via callback que cada SettingRow chama no mount.
 */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const search = useSearch();
  // Quando query vazia, mostra tudo. Quando query ativa, contamos via
  // matchesGroupHeader (busca também o título do grupo).
  // Pra esconder grupos sem matches: deixamos os SettingRow se hidearem
  // individualmente; se nenhum filho renderizar conteúdo, o grupo fica vazio.
  // Pra detectar isso usamos um ref que conta os children que se anunciaram.
  // Simplificação pragmática: se query bate no group title, força mostrar
  // todos os rows (passamos um "force-visible" via context aninhado).
  const groupMatchesTitle = search.matches(title);

  // Visibility tracking: SettingRows registram-se via context. Se todos
  // marcam hidden, escondemos o group. Usamos counter em ref pra evitar
  // re-render loop.
  const [visibleCount, setVisibleCount] = useState(0);
  const visibleRef = useRef(0);
  const register = useCallback(() => {
    visibleRef.current += 1;
    // Batched update via microtask pra evitar set-during-render
    queueMicrotask(() => setVisibleCount(visibleRef.current));
    return () => {
      visibleRef.current -= 1;
      queueMicrotask(() => setVisibleCount(visibleRef.current));
    };
  }, []);

  // Reset counter quando query muda (children vão re-registrar)
  useEffect(() => {
    visibleRef.current = 0;
    setVisibleCount(0);
  }, [search.query]);

  const ctx = useMemo<GroupContextValue>(
    () => ({ forceVisible: groupMatchesTitle, register }),
    [groupMatchesTitle, register],
  );

  // Esconde o grupo inteiro se nenhuma row é visível E o título não bate.
  const hidden = !groupMatchesTitle && search.query !== '' && visibleCount === 0;

  return (
    <GroupContext.Provider value={ctx}>
      <div className={`settings-group ${hidden ? 'is-hidden' : ''}`} aria-hidden={hidden}>
        <h3 className="settings-group-title">{title}</h3>
        <div className="settings-group-rows">{children}</div>
      </div>
    </GroupContext.Provider>
  );
}

interface GroupContextValue {
  /** Se true (group title matches search), todos os rows filhos ignoram filtro. */
  forceVisible: boolean;
  /** Callback chamado quando um row visível monta — retorna unsubscribe. */
  register: () => () => void;
}
const GroupContext = createContext<GroupContextValue>({
  forceVisible: false,
  register: () => () => {},
});

/**
 * SettingRow — row padrão: label + helper text à esquerda, controle à direita.
 * Se search query ativa e nem label nem helper batem (e o group title também
 * não bate), o row se esconde.
 */
function SettingRow({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: string;
  children: ReactNode;
}) {
  const search = useSearch();
  const group = useContext(GroupContext);
  const visible = group.forceVisible || search.matches(label, helper);

  // Registra-se no parent group enquanto visível (pra group decidir se some)
  useEffect(() => {
    if (!visible) return;
    return group.register();
  }, [visible, group]);

  if (!visible) return null;

  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {helper && <div className="settings-row-helper">{helper}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

// ============================================================================
// Controls
// ============================================================================

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      className={`settings-toggle ${value ? 'is-on' : ''}`}
      onClick={() => onChange(!value)}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

function SegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="settings-segmented">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          className={`settings-segmented-btn ${value === opt.value ? 'is-active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <select
      className="settings-select"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/**
 * ThemePicker — single-option (UNDRCOD) com swatch da cor accent.
 * Mantido como segmented vertical pra deixar espaço pra novos temas depois.
 */
const THEME_OPTIONS: Array<{
  value: ThemeMode;
  label: string;
  description: string;
  swatch: string;
  surface: string;
}> = [
  {
    value: 'undrcod',
    label: 'UNDRCOD',
    description: 'Único tema — dark + Antigravity Blue',
    swatch: '#4F8FFA',
    surface: '#0d0d0d',
  },
];

function ThemePicker({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (v: ThemeMode) => void;
}) {
  return (
    <div className="settings-theme-picker" role="radiogroup" aria-label="Tema">
      {THEME_OPTIONS.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            className={`settings-theme-option ${isActive ? 'is-active' : ''}`}
            onClick={() => onChange(opt.value)}
            title={opt.description}
          >
            <span
              className="settings-theme-swatch"
              style={{
                background: opt.surface,
                borderColor: isActive ? opt.swatch : undefined,
              }}
            >
              <span
                className="settings-theme-swatch-dot"
                style={{ background: opt.swatch }}
              />
            </span>
            <span className="settings-theme-option-text">
              <span className="settings-theme-option-label">{opt.label}</span>
              <span className="settings-theme-option-desc">{opt.description}</span>
            </span>
            {isActive && (
              <i className="codicon codicon-check settings-theme-option-check" aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );
}
