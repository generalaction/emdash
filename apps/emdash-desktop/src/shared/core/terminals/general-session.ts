import type { TmuxSessionConfig } from '@shared/core/pty/tmux';

export interface GeneralSession {
  type: 'general';
  config: GeneralSessionConfig;
}

export interface GeneralSessionConfig {
  taskId?: string;
  cwd: string;
  projectPath?: string;
  shellSetup?: string;
  tmuxSession?: TmuxSessionConfig;
  command?: string;
  args?: string[];
}
