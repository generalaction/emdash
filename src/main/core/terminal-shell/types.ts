import type { RuntimeTerminalShellId, TerminalShellFamily } from '@shared/terminal-settings';

export type ResolvedShellProfile = {
  id: RuntimeTerminalShellId | 'target-default';
  resolvedShellId: RuntimeTerminalShellId;
  resolvedFromSystem: boolean;
  executable: string;
  available: true;
  family: TerminalShellFamily;
  interactiveArgs: string[];
  commandArgs: string[];
  envCaptureArgs?: string[];
  capturedEnv?: Record<string, string>;
  remotePathLookup?: boolean;
};
