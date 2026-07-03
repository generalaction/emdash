import type { SessionConfigOption, SessionModeState, StopReason } from '@agentclientprotocol/sdk';
import type { AcpPermissionRequest } from './models/permissions';
import type { QueuedPrompt, SessionLifecycle as MachineSessionLifecycle } from './session-machine';

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
  queuedPrompts: QueuedPrompt[];
  agentTurnActive: boolean;
  backgroundAgentCount: number;
  isGenerating: boolean;
  canSubmit: boolean;
  canCancel: boolean;
}

export function toSessionSnapshot(s: SessionState): SessionSnapshot {
  return {
    lifecycle: s.lifecycle,
    activeTurnId: s.activeTurnId,
    pendingPermissions: s.pendingPermissions,
    modes: s.modes,
    configOptions: s.configOptions,
    lastStopReason: s.lastStopReason,
    queuedPrompts: s.queuedPrompts,
    agentTurnActive: s.agentTurnActive,
    backgroundAgentCount: s.backgroundAgentCount,
    isGenerating: s.isGenerating,
    canSubmit: s.canSubmit,
    canCancel: s.canCancel,
  };
}

export interface SessionState {
  lifecycle: SessionLifecycle;
  activeTurnId: string | null;
  pendingPermissions: AcpPermissionRequest[];
  modes: SessionModeState | null;
  configOptions: SessionConfigOption[];
  lastStopReason: StopReason | null;
  queuedPrompts: QueuedPrompt[];
  agentTurnActive: boolean;
  backgroundAgentCount: number;
  isGenerating: boolean;
  canSubmit: boolean;
  canCancel: boolean;
}
