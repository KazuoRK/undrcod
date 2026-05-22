/**
 * snippets — helpers pra prompts pré-salvos do composer (Ctrl+;).
 *
 * Persistência: localStorage key `undrcode.snippets` = JSON Array<Snippet>.
 * Ordem da lista é a ordem de exibição no picker (não re-ordena por uso).
 *
 * Quando o storage tá vazio (primeira vez), retorna defaults pré-instalados:
 * "Explicar código", "Refatorar", "Escrever testes", "Code review". O save
 * subsequente substitui defaults — user pode deletar todos sem reaparecerem.
 *
 * Para distinguir "nunca configurado" de "configurado vazio", marcamos
 * `undrcode.snippets.seeded = '1'` no primeiro save.
 */

const KEY = 'undrcode.snippets';
const SEEDED_KEY = 'undrcode.snippets.seeded';

export interface Snippet {
  id: string;
  name: string;
  body: string;
  createdAt: number;
}

const DEFAULTS: Omit<Snippet, 'id' | 'createdAt'>[] = [
  {
    name: 'Explicar código',
    body: 'Explique passo a passo o que esse código faz, destacando partes não-óbvias e possíveis efeitos colaterais.',
  },
  {
    name: 'Refatorar',
    body: 'Refatore esse código pra melhorar legibilidade e manutenibilidade sem mudar o comportamento. Justifique cada alteração.',
  },
  {
    name: 'Escrever testes',
    body: 'Escreva testes unitários cobrindo casos felizes, casos de borda e cenários de erro. Use o framework de teste já usado no projeto.',
  },
  {
    name: 'Code review',
    body: 'Faça um code review focando em: bugs, segurança, performance, legibilidade e aderência aos padrões do projeto. Liste issues por severidade.',
  },
];

function makeId(): string {
  try {
    // crypto.randomUUID disponível em Electron renderer moderno
    return crypto.randomUUID();
  } catch {
    return `snip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

function buildDefaults(): Snippet[] {
  const now = Date.now();
  return DEFAULTS.map((d, i) => ({
    id: makeId(),
    name: d.name,
    body: d.body,
    // pequena variação no createdAt pra manter ordem estável
    createdAt: now + i,
  }));
}

/** Lê snippets persistidos. Se nunca foi seedado, retorna defaults (em memória, não persiste). */
export function loadSnippets(): Snippet[] {
  try {
    const seeded = localStorage.getItem(SEEDED_KEY) === '1';
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      // Nunca seedado → retorna defaults sem persistir (persistência só rola no primeiro save).
      // Se já foi seedado e raw é null → considera lista vazia legítima.
      return seeded ? [] : buildDefaults();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return seeded ? [] : buildDefaults();
    return parsed.filter((s): s is Snippet =>
      typeof s === 'object' && s !== null &&
      typeof s.id === 'string' &&
      typeof s.name === 'string' &&
      typeof s.body === 'string' &&
      typeof s.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

/** Salva lista. Marca como "seedado" pra evitar reaparição de defaults se user deletar tudo. */
export function saveSnippets(list: Snippet[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    localStorage.setItem(SEEDED_KEY, '1');
  } catch {
    /* quota? noop */
  }
}

/** Cria um snippet novo com id + createdAt preenchidos. Não persiste. */
export function createSnippet(name: string, body: string): Snippet {
  return {
    id: makeId(),
    name,
    body,
    createdAt: Date.now(),
  };
}
