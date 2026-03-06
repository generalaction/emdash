import { PtySession } from '../core';

export interface LifecycleSession {
  type: 'lifecycle';
  config: LifecycleSessionConfig;
  pty: PtySession;
}

type LifecyclePhase = 'setup' | 'run' | 'teardown';

export interface LifecycleSessionConfig {
  phase: LifecyclePhase;
  cwd: string;
  command: string;
  env: Record<string, string>;
  onExit: (exitCode: number) => void;
}
