import { err, ok, type Result } from '@emdash/shared';
import {
  throwWorkspacesRuntimeResolveError,
  type WorkspacesHostRuntimesClient,
  type WorkspacesRuntimeResolveError as RuntimeResolveError,
} from '@core/features/workspaces/api/runtime-adapter';
import { filesClientScope, type FilesClientScope } from '@main/core/files/runtime-client';
import { getDesktopRuntimeBroker } from '@main/gateway/runtime-broker';
import type { WorkspaceIdentity } from './workspace-identity-service';
import { workspaceIdentityService } from './workspace-identity-source';

export type WorkspaceRuntimeAccess = Readonly<{
  identity: WorkspaceIdentity;
  client: WorkspacesHostRuntimesClient;
  files: FilesClientScope;
  release(): Promise<void>;
}>;

export async function acquireWorkspaceRuntime(
  workspaceId: string
): Promise<WorkspaceRuntimeAccess | null> {
  const result = await tryAcquireWorkspaceRuntime(workspaceId);
  if (!result.success) throwWorkspacesRuntimeResolveError(result.error);
  return result.data;
}

export async function tryAcquireWorkspaceRuntime(
  workspaceId: string
): Promise<Result<WorkspaceRuntimeAccess | null, RuntimeResolveError>> {
  const identity = await workspaceIdentityService.resolve(workspaceId);
  if (!identity) return ok(null);

  const lease = getDesktopRuntimeBroker().session(identity.host);
  try {
    const runtime = await lease.ready();
    if (!runtime.success) {
      await lease.release();
      return err(runtime.error);
    }
    return ok({
      identity,
      client: runtime.data,
      files: filesClientScope(runtime.data.files, identity.path),
      release: () => lease.release(),
    });
  } catch (error) {
    await lease.release();
    throw error;
  }
}

export async function withWorkspaceRuntime<T>(
  workspaceId: string,
  work: (access: WorkspaceRuntimeAccess) => Promise<T>
): Promise<T | null> {
  const access = await acquireWorkspaceRuntime(workspaceId);
  if (!access) return null;
  try {
    return await work(access);
  } finally {
    await access.release();
  }
}
