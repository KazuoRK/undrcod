/**
 * curated-skills — catálogo embarcado de skills recomendadas pro agente.
 *
 * Esses são SKILLs do Claude Code (markdown files com YAML frontmatter que
 * estendem o comportamento do agente) selecionadas a dedo. Não são plugins
 * (bundles do marketplace) nem extensions do VS Code.
 *
 * Instalação acontece via CLI `skills` da Anthropic:
 *   npx skills add <source> [--skill <filter>]
 *
 * O install path padrão é `<cwd>/.claude/skills/<name>/`. Pra instalar a
 * nível de usuário (`~/.claude/skills/`), o backend roda o comando com
 * cwd = homedir.
 *
 * Detecção de "já instalada" cruza o slug com o que o customization-manager
 * lista (workspace + user + plugins).
 */

export type SkillCategory =
  | 'design'        // UI/UX, frontend craft
  | 'meta'          // skills que ajudam a criar outras skills
  | 'debug'         // debugging frameworks
  | 'backend'       // scalability, APIs, DB
  | 'security'      // security audit, secret scanning
  | 'testing';      // E2E, Playwright

export interface CuratedSkill {
  /** Identificador único = nome do diretório em `.claude/skills/<id>/`.
   *  Match contra `customization.listSkills()` pra detectar "já instalada". */
  id: string;
  /** Nome de exibição. */
  name: string;
  /** Descrição curta (1-2 frases). */
  description: string;
  /** Source pra `npx skills add` — owner/repo ou URL completa. */
  source: string;
  /** Filtro opcional `--skill <name>` (pra repos com múltiplas skills). */
  skillFilter?: string;
  /** Categoria — usada pra agrupar visualmente. */
  category: SkillCategory;
  /** URL do repo pra "ver no GitHub". */
  repoUrl: string;
  /** Tagline curta pro card (≤ 60 chars). */
  tagline: string;
}

/**
 * Catálogo de 10 skills curadas — 5 frontend-craft + 5 general agent.
 * Compilado de:
 *   - @devemdobro (4/mai): Frontend Design, Debugging, Skill Creator, Scalability, Security
 *   - @fabianocarvalhojr (4/mai): Impeccable, Huashu, UI/UX Pro Max, Taste, Playwright
 */
export const CURATED_SKILLS: CuratedSkill[] = [
  // === Design / Frontend Craft ===
  {
    id: 'impeccable',
    name: 'Impeccable',
    description: 'Detecta 29 anti-patterns de "AI slop" — gradient text, glassmorphism, nested cards, bounce easing, contraste OKLCH quebrado. Inclui /audit, /polish, /critique.',
    source: 'pbakaus/impeccable',
    category: 'design',
    repoUrl: 'https://github.com/pbakaus/impeccable',
    tagline: 'Mata AI slop antes do código subir',
  },
  {
    id: 'frontend-design',
    name: 'Frontend Design',
    description: 'Skill oficial da Anthropic. Gera UIs production-grade que fogem do visual genérico de IA — display fonts, hierarquia visual, composição assimétrica, motion deliberado.',
    source: 'anthropics/skills',
    skillFilter: 'frontend-design',
    category: 'design',
    repoUrl: 'https://github.com/anthropics/skills/tree/main/skills/frontend-design',
    tagline: '110k installs/semana — a base do mercado',
  },
  {
    id: 'huashu-design',
    name: 'Huashu Design',
    description: 'Hi-fi prototypes clicáveis, slide decks (HTML+PPTX), animações MP4/GIF, infográficos print-ready. Memory architecture que persiste entre sessões.',
    source: 'alchaincyf/huashu-design',
    category: 'design',
    repoUrl: 'https://github.com/alchaincyf/huashu-design',
    tagline: 'O clone do Claude Design',
  },
  {
    id: 'ui-ux-pro-max',
    name: 'UI/UX Pro Max',
    description: 'Database com 50+ styles, 161 paletas, 57 font pairings, 99 regras de UX em 15 stacks (React, Next, Astro, Vue, Svelte, SwiftUI). Design system inteiro em uma skill.',
    source: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    skillFilter: 'ui-ux-pro-max',
    category: 'design',
    repoUrl: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    tagline: 'Design system inteiro embarcado',
  },
  {
    id: 'taste-skill',
    name: 'Taste',
    description: '"High-agency frontend" com 3 dials tunáveis: DESIGN_VARIANCE (1-10), MOTION_INTENSITY (1-10), VISUAL_DENSITY (1-10). Framework-agnostic.',
    source: 'Leonxlnx/taste-skill',
    category: 'design',
    repoUrl: 'https://github.com/Leonxlnx/taste-skill',
    tagline: 'Bom gosto regulável em 3 dials',
  },

  // === General Agent ===
  {
    id: 'superpowers',
    name: 'Superpowers (Debugging)',
    description: 'Framework agêntico com 20+ skills. Enforce 4 fases pra debug (root cause → pattern → hypothesis → fix). Iron law: "NO FIXES WITHOUT ROOT CAUSE FIRST".',
    source: 'obra/superpowers',
    category: 'debug',
    repoUrl: 'https://github.com/obra/superpowers',
    tagline: 'Para de trial-and-error, resolve bug de verdade',
  },
  {
    id: 'skill-creator',
    name: 'Skill Creator',
    description: 'A meta-skill. Você descreve um processo e ela gera um SKILL.md com YAML frontmatter pronto pra carregar via progressive disclosure. Faz eval/benchmark.',
    source: 'anthropics/skills',
    skillFilter: 'skill-creator',
    category: 'meta',
    repoUrl: 'https://github.com/anthropics/skills/tree/main/skills/skill-creator',
    tagline: 'Skill pra criar outras skills',
  },
  {
    id: 'backend-development',
    name: 'Backend / Scalability',
    description: 'API design (REST/GraphQL/gRPC), caching (Redis -90% DB load), DB (PostgreSQL/MongoDB/indexação), filas, auth (OAuth+PKCE, Argon2id), DevOps (K8s, OpenTelemetry).',
    source: 'samhvw8/dotfiles',
    skillFilter: 'backend-development',
    category: 'backend',
    repoUrl: 'https://github.com/samhvw8/dotfiles',
    tagline: 'Sistemas que crescem sem reescrita',
  },
  {
    id: 'security-review',
    name: 'Security Review',
    description: 'Auto-ativa em auth, file uploads, endpoints, secrets, pagamentos. Caça apiKey hardcoded, SQL injection, security headers, padrões de auth.',
    source: 'davila7/claude-code-templates',
    skillFilter: 'security-review',
    category: 'security',
    repoUrl: 'https://github.com/davila7/claude-code-templates',
    tagline: 'Audit de segurança automático',
  },
  {
    id: 'playwright-skill',
    name: 'Playwright',
    description: '70+ guias production-tested de Playwright em 5 packs. Para de chutar locators e auth flows. 115k tokens via MCP vs 25k via CLI — 75%+ do contexto sobra pra raciocínio.',
    source: 'testdino-hq/playwright-skill',
    category: 'testing',
    repoUrl: 'https://github.com/testdino-hq/playwright-skill',
    tagline: 'O agente vê a UI antes de você ver o bug',
  },
];

/** Lookup rápido por id. */
export const CURATED_SKILLS_BY_ID = new Map(
  CURATED_SKILLS.map((s) => [s.id, s] as const),
);

/** Label legível por categoria (pra section headers). */
export const CATEGORY_LABELS: Record<SkillCategory, string> = {
  design: 'Design / Frontend',
  meta: 'Meta',
  debug: 'Debug',
  backend: 'Backend',
  security: 'Segurança',
  testing: 'Testing',
};
