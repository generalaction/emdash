import type { SerializedHostRef } from '@emdash/core/primitives/host/api';
import type { WorkspaceHostSnapshotTier } from '@emdash/core/runtimes/workspace-host/api';

export interface SnapshotRequester {
  requestRepoPath(
    hostRef: SerializedHostRef,
    repoPath: string,
    tier: WorkspaceHostSnapshotTier
  ): Promise<void>;
  requestHost(connectionId: string, tier: WorkspaceHostSnapshotTier): Promise<void>;
}
