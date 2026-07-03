import type {
  AvailableCommand,
  SessionConfigOption,
  SessionModeState,
  StopReason,
} from '@agentclientprotocol/sdk';
import type { AcpPermissionRequest } from './models/permissions';
import type { SessionLifecycle as MachineSessionLifecycle } from './session-machine';

export type SessionLifecycle = MachineSessionLifecycle;

export interface SessionUsage {
  contextSize: number;
  contextUsed: number;
  cost: { amount: number; currency: string } | null;
}

export interface AcpPromptImage {
  data: string;
  mimeType: string;
  name?: string;
}

export interface SessionSnapshot {
  lifecycle: SessionLifecycle;
  activeTurnId: string | null;
  pendingPermissions: AcpPermissionRequest[];
  modes: SessionModeState | null;
  configOptions: SessionConfigOption[];
  availableCommands: AvailableCommand[];
  lastStopReason: StopReason | null;
  usage: SessionUsage | null;
}

export function toSessionSnapshot(s: SessionState): SessionSnapshot {
  return {
    lifecycle: s.lifecycle,
    activeTurnId: s.activeTurnId,
    pendingPermissions: s.pendingPermissions,
    modes: s.modes,
    configOptions: s.configOptions,
    availableCommands: s.availableCommands,
    lastStopReason: s.lastStopReason,
    usage: s.usage,
  };
}

export interface SessionState {
  lifecycle: SessionLifecycle;
  activeTurnId: string | null;
  pendingPermissions: AcpPermissionRequest[];
  modes: SessionModeState | null;
  configOptions: SessionConfigOption[];
  availableCommands: AvailableCommand[];
  lastStopReason: StopReason | null;
  usage: SessionUsage | null;
}
