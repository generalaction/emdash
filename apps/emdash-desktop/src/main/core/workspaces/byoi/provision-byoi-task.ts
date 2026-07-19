import type { HostRef } from '@emdash/core/primitives/host/api';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { err, type Result } from '@emdash/shared';
import { runtimeCapabilityNotConfigured } from '@core/features/runtime-routing/api';
import type { WorkspaceBootstrapResult } from '@main/core/workspaces/workspace-bootstrap-service';

export type ProvisionBYOITaskParams = {
  host: HostRef;
};

export async function provisionBYOITask(
  params: ProvisionBYOITaskParams
): Promise<Result<WorkspaceBootstrapResult, RuntimeResolveError>> {
  // TODO(workspace-server): Restore the full provisioning input when BYOI execution moves
  // behind the workspace-server runtime boundary.
  return err(runtimeCapabilityNotConfigured(params.host, 'workspaces'));
}
