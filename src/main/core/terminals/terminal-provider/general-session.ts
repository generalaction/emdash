export interface GeneralSession {
  type: 'general';
  config: GeneralSessionConfig;
}

export interface GeneralSessionConfig {
  taskId?: string;
  cwd: string;
  /** Project root — used to resolve .emdash.json shellSetup. */
  projectPath?: string;
  /** Shell command prepended before the interactive shell: `${shellSetup} && exec $SHELL`. */
  shellSetup?: string;
}
