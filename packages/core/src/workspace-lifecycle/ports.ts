import type { Result } from '@emdash/shared';
import type { LifecycleState, WorkspaceLifecyclePhase } from './api/schemas';

export type WorkspaceLifecycleHooks = {
  beforeTeardown?(event: {
    workspaceId: string;
    path: string;
    force: boolean;
    signal: AbortSignal;
  }): Promise<Result<void, { type: 'workspace-busy'; holders: string[] }>>;
  onPhaseChanged?(event: {
    workspaceId: string;
    phase: WorkspaceLifecyclePhase;
    path?: string;
  }): void;
};

export type WorkspaceLifecycleLogger = {
  warn?(message: string, meta?: unknown): void;
};

export type LifecycleSnapshot = LifecycleState;
