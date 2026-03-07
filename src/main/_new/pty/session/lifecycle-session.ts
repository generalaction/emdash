export interface LifecycleSession {
  type: 'lifecycle';
  config: LifecycleSessionConfig;
}

export type LifecyclePhase = 'setup' | 'run' | 'teardown';

export interface LifecycleSessionConfig {
  taskId?: string;
  phase: LifecyclePhase;
  cwd: string;
  command: string;
  /** Additional env vars merged on top of the base session env. */
  extraEnv?: Record<string, string>;
  onExit?: (exitCode: number | undefined) => void;
}
