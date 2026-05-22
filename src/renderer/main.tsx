import React from 'react';
import ReactDOM from 'react-dom/client';
import '@vscode/codicons/dist/codicon.css';
import './utils/prismSetup';
import './styles/prism-undrcod.css';
import { App } from './App';
import { AgentManager } from './components/AgentManager/AgentManager';
import { ErrorBoundary } from './components/ErrorBoundary/ErrorBoundary';
import './styles/global.css';

// Monaco Editor: workers REAIS via Vite ?worker.
// Sem isso, Monaco fica em "Loading..." pra sempre quando tenta computar
// hover/IntelliSense/color preview (provider espera resposta do worker
// que nunca chega no stub). Vite bundle cada worker como JS separado
// e CSP do index.html já permite `worker-src 'self' blob:;`.
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

// VS Code-like completions: configura TS/JS compiler options + snippets + builtins.
// Roda UMA vez antes do primeiro Editor montar. Setups internos são idempotentes.
// project-context.ts e node-modules-types.ts são carregados on-demand quando
// workspace abre (App.tsx useEffect[cwd]).
import { configureMonacoTypeScript } from './services/monaco-setup';
import { registerSnippets } from './services/snippets';
import { registerLanguageBuiltins } from './services/language-builtins';
configureMonacoTypeScript();
registerSnippets();
registerLanguageBuiltins();

// Captura erros que escapam do React (async, Promises) — não substituem o
// boundary, mas garantem que nada some silenciosamente no console.
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled]', e.reason);
});
window.addEventListener('error', (e) => {
  console.error('[error]', e.error ?? e.message);
});

// Agent Manager mode — janela aberta via window:openAgentManager tem ?mode=agent.
// Renderiza componente dedicado em vez do App full. Decisão feita no boot —
// não muda em runtime (precisaria reload).
const isAgentManagerMode = new URLSearchParams(window.location.search).get('mode') === 'agent';
const RootComponent = isAgentManagerMode ? AgentManager : App;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RootComponent />
    </ErrorBoundary>
  </React.StrictMode>
);
