/**
 * Types compartilhados entre main, preload e renderer.
 * Mantém aqui só dados serializáveis (passam por IPC).
 */

export interface FsNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FsNode[]; // populado lazy
}

export interface ClaudeSession {
  ptyId: string;
  cwd: string;
  startedAt: number;
  status: 'starting' | 'ready' | 'thinking' | 'idle' | 'error' | 'closed';
}

export interface AppSettings {
  workspace?: string;
  fontSize: number;
  theme: 'undrcod-dark' | 'undrcod-light';
  showEditor: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 14,
  theme: 'undrcod-dark',
  showEditor: false
};
