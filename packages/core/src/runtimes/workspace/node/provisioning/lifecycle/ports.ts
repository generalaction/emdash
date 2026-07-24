import type { Result } from '@emdash/shared';
import type {
  LifecycleState,
  WorkspaceLifecyclePhase,
} from '@runtimes/workspace/api/provisioning/schemas';

export type WorkspaceLifecycleHooks = {
  beforeTeardown?(event: {
    path: string;
    force: boolean;
    signal: AbortSignal;
  }): Promise<Result<void, { type: 'workspace-busy'; holders: string[] }>>;
  onPhaseChanged?(event: { path: string; phase: WorkspaceLifecyclePhase }): void;
};

export type WorkspaceLifecycleLogger = {
  warn?(message: string, meta?: unknown): void;
};

export type LifecycleSnapshot = LifecycleState;
