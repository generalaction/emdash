import type { RuntimeTerminalShellId, TerminalShellFamily } from '@core/primitives/terminals/api';

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
