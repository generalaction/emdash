import type { TerminalShellId } from './terminal-settings';

export interface GeneralSession {
  type: 'general';
  config: GeneralSessionConfig;
}

export interface GeneralSessionConfig {
  taskId?: string;
  cwd: string;
  projectPath?: string;
  shell?: TerminalShellId;
  shellSetup?: string;
  tmuxSessionName?: string;
  command?: string;
  args?: string[];
}
