# Release — Build de instaladores via GitHub Actions

Workflow em `.github/workflows/release.yml` builda Windows + macOS automaticamente.
Custo: $0 pra repos públicos (Mac runner é caro mas free pra OSS).

## Setup inicial (1× só)

1. **Cria repo no GitHub**:
   ```bash
   # Recomendo usar `undrcod` ou `undrcode` (já sem o "e" pra consistência de brand)
   gh repo create undrcod/undrcod --public --source=. --remote=origin
   # OU manual: cria via UI do GitHub, depois:
   git remote add origin https://github.com/SEU-USER/undrcod.git
   ```

2. **Primeiro push**:
   ```bash
   cd C:\Users\taked\Desktop\undrcode
   git add .
   git commit -m "Initial UNDRCOD release setup"
   git push -u origin main
   ```

3. **Verifica Actions ativo**: vai em `https://github.com/SEU-USER/undrcod/actions`. Se o tab "Actions" aparece, tá ligado.

## Gerar uma release (toda vez que quiser instaladores novos)

```bash
# Bump version no package.json (sem o "v")
npm version patch       # 0.0.1 → 0.0.2
# ou: npm version minor / major

# Push da tag → dispara o workflow
git push origin --follow-tags
```

GitHub Actions:
- Builda Windows (NSIS + ZIP) em `windows-latest` runner
- Builda macOS (DMG + ZIP, ambos arch arm64 + x64) em `macos-latest` runner
- Junta tudo em uma **GitHub Release** com release notes auto-geradas
- ~8-12 min total

## Como o primo baixa

Mandar link `https://github.com/SEU-USER/undrcod/releases/latest`.

**Windows primo**:
- Baixa `UNDRCOD Setup X.Y.Z.exe` → roda → wizard NSIS → instala
- Vai aparecer SmartScreen warning "Unknown publisher" → "More info" → "Run anyway" (esperado, app sem code signing)

**Mac primo**:
- Baixa `UNDRCOD-X.Y.Z-arm64.dmg` (Apple Silicon M1/M2/M3) ou `UNDRCOD-X.Y.Z-x64.dmg` (Intel)
- Abre → arrasta UNDRCOD pra Applications
- Primeira abertura: Finder vai bloquear ("não pode ser aberto porque é de developer não identificado")
- Workaround: **Direito → Abrir** (NÃO double-click) → "Abrir mesmo assim". Só na primeira vez.

## Build manual sem tag (pra testar workflow)

Vai em Actions → "Release UNDRCOD" → "Run workflow" → branch `main` → Run. Sai sem criar Release, mas os artifacts ficam pra download direto do run.

## Configuração de signing (opcional, futuro)

Sem code signing, ambos OSes mostram aviso de "developer não confiável" na primeira execução. Pra remover:
- **Windows**: cert EV ($300-700/ano) → adicionar `CSC_LINK` + `CSC_KEY_PASSWORD` em GitHub Secrets
- **macOS**: Apple Developer Program ($99/ano) + Notarization → `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` em Secrets

Por enquanto: sem signing, primo confia em você direto, clica "abrir mesmo assim".

## Troubleshooting

- **`npm ci` falha** no CI: package-lock.json desincronizado com package.json. Roda `npm install` local + commit do lock atualizado.
- **Build Mac timeout**: macos-latest runners às vezes ficam lentos. Re-run o job (raramente precisa).
- **NSIS falha no Windows CI**: muito raro (runner é admin), mas se acontecer, é symlink/permission issue. Comentar `nsis` target em package.json temporariamente.
