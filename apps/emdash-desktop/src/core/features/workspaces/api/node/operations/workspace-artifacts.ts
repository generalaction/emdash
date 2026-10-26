import type { CleanArtifactsError } from '@emdash/core/runtimes/workspace-registry/api';
import { err, ok, type Result } from '@emdash/shared';
import type { MutationAck, MutationError } from '@core/primitives/wire/api/mutations';
import type { WorkspaceRegistryRuntimeClient } from '@core/services/runtime-broker/api/clients';

/**
 * Clean Artifacts: the host registry removes the workspace's artifacts in place —
 * exactly what its usage reports as reclaimable — and keeps the worktree, its
 * tracked and uncommitted work, and its tasks. No desktop record changes.
 */
export async function cleanWorkspaceArtifactsThroughRegistry(
  registry: Pick<WorkspaceRegistryRuntimeClient, 'cleanArtifacts'>,
  workspaceId: string
): Promise<Result<MutationAck, MutationError>> {
  // Waits for the whole removal: the contract gives cleanArtifacts no call deadline, since
  // removing a large dependency tree has no fixed bound.
  const cleaned = await registry.cleanArtifacts({ workspaceId });
  if (cleaned.success) return ok({});
  return err({ type: cleaned.error.type, message: cleanArtifactsErrorMessage(cleaned.error) });
}

function cleanArtifactsErrorMessage(error: CleanArtifactsError): string {
  switch (error.type) {
    case 'workspace-active':
      return 'Agents or terminals are running in this workspace. Stop them, then try again.';
    case 'workspace-missing':
      return 'The workspace folder is missing.';
    case 'workspace-not-found':
      return 'The workspace is not registered on the host.';
    default:
      return error.message;
  }
}
