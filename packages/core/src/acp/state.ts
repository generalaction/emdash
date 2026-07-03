import type { SessionConfigOption, SessionModeState, StopReason } from '@agentclientprotocol/sdk';
import type { AcpPermissionRequest } from './models/permissions';
import type { SessionLifecycle as MachineSessionLifecycle } from './session-machine';

export type SessionLifecycle = MachineSessionLifecycle;

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
  lastStopReason: StopReason | null;
}

export function toSessionSnapshot(s: SessionState): SessionSnapshot {
  return {
    lifecycle: s.lifecycle,
    activeTurnId: s.activeTurnId,
    pendingPermissions: s.pendingPermissions,
    modes: s.modes,
    configOptions: s.configOptions,
    lastStopReason: s.lastStopReason,
  };
}

export interface SessionState {
  lifecycle: SessionLifecycle;
  activeTurnId: string | null;
  pendingPermissions: AcpPermissionRequest[];
  modes: SessionModeState | null;
  configOptions: SessionConfigOption[];
  lastStopReason: StopReason | null;
}
