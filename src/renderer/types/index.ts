export interface Repo {
  id: string;
  path: string;
  origin: string;
  defaultBranch: string;
  lastActivity?: string;
  changes?: {
    added: number;
    removed: number;
  };
}

export interface Run {
  id: string;
  repoId: string;
  branch: string;
  worktreePath: string;
  provider: 'claude-code' | 'openai-agents';
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  tokenUsage: number;
  cost: number;
}

export interface RunEvent {
  runId: string;
  timestamp: string;
  kind: 'llm' | 'tool' | 'bash' | 'git' | 'diff' | 'error';
  payload: any;
}

export interface Settings {
  claudeApiKey?: string;
  openaiApiKey?: string;
  githubToken?: string;
  defaultProvider: 'claude-code' | 'openai-agents';
  maxConcurrentRuns: number;
}

export interface Workspace {
  id: string;
  name: string;
  repos: Repo[];
}

export type Provider =
  | 'codex'
  | 'claude'
  | 'qwen'
  | 'droid'
  | 'gemini'
  | 'cursor'
  | 'copilot'
  | 'amp'
  | 'opencode'
  | 'charm'
  | 'auggie'
  | 'goose';

// Keyboard shortcuts types
export type {
  ShortcutConfig,
  ShortcutModifier,
  KeyboardShortcut,
  ShortcutMapping,
  GlobalShortcutHandlers,
} from './shortcuts';
