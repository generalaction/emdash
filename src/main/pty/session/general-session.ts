import { PtySession } from '../core';

export interface GeneralSession {
  type: 'general';
  config: GeneralSessionConfig;
  pty: PtySession;
}

export interface GeneralSessionConfig {
  cwd: string;
  shellSetup?: string;
}
