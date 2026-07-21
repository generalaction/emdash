import { acquireWorkspaceRuntime } from '@core/features/workspaces/api/node/runtime-access';
import { getWorkspaceIdentityService } from '@main/bootstrap/core/service-instances';
import { getDesktopRuntimeBroker } from './runtime-broker';

export function acquireDesktopWorkspaceRuntime(workspaceId: string) {
  return acquireWorkspaceRuntime(
    getDesktopRuntimeBroker(),
    getWorkspaceIdentityService(),
    workspaceId
  );
}
