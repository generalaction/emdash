export interface GeneralSession {
  type: 'general';
  config: GeneralSessionConfig;
}

export interface GeneralSessionConfig {
  taskId?: string;
  cwd: string;
  projectPath?: string;
  shellSetup?: string;
  multiplexer?: { id: 'tmux' | 'boo'; sessionName: string };
  command?: string;
  args?: string[];
}
