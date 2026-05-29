import type { ExplicitTerminalShellId, TerminalShellFamily } from '@shared/terminal-settings';

export type ResolvedShellProfile = {
  id: ExplicitTerminalShellId | 'target-default';
  resolvedShellId: ExplicitTerminalShellId;
  resolvedFromAuto: boolean;
  executable: string;
  displayName: string;
  available: true;
  family: TerminalShellFamily;
  interactiveArgs: string[];
  commandArgs: string[];
  envCaptureArgs?: string[];
  capturedEnv?: Record<string, string>;
  remotePathLookup?: boolean;
};
