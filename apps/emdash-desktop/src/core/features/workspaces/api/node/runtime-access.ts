import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { WorkspaceIdentity } from '@core/features/workspaces/api/node/workspace-identity-service';
import {
  throwWorkspacesRuntimeResolveError,
  type WorkspacesHostRuntimesClient,
  type WorkspacesRuntimeResolveError as RuntimeResolveError,
} from '@core/features/workspaces/api/runtime-adapter';
import { filesClientScope, type FilesClientScope } from '@core/services/runtime-broker/node/files';

export type WorkspaceRuntimeAccess = Readonly<{
  identity: WorkspaceIdentity;
  client: WorkspacesHostRuntimesClient;
  files: FilesClientScope;
  release(): Promise<void>;
}>;

export type WorkspaceRuntimeIdentityResolver = {
  resolve(workspaceId: string): Promise<WorkspaceIdentity | null>;
};

export async function acquireWorkspaceRuntime(
  runtimes: RuntimeBroker,
  workspaceIdentity: WorkspaceRuntimeIdentityResolver,
  workspaceId: string
): Promise<WorkspaceRuntimeAccess | null> {
  const result = await tryAcquireWorkspaceRuntime(runtimes, workspaceIdentity, workspaceId);
  if (!result.success) throwWorkspacesRuntimeResolveError(result.error);
  return result.data;
}

export async function tryAcquireWorkspaceRuntime(
  runtimes: RuntimeBroker,
  workspaceIdentity: WorkspaceRuntimeIdentityResolver,
  workspaceId: string
): Promise<Result<WorkspaceRuntimeAccess | null, RuntimeResolveError>> {
  const identity = await workspaceIdentity.resolve(workspaceId);
  if (!identity) return ok(null);

  const lease = runtimes.session(identity.host);
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
  runtimes: RuntimeBroker,
  workspaceIdentity: WorkspaceRuntimeIdentityResolver,
  workspaceId: string,
  work: (access: WorkspaceRuntimeAccess) => Promise<T>
): Promise<T | null> {
  const access = await acquireWorkspaceRuntime(runtimes, workspaceIdentity, workspaceId);
  if (!access) return null;
  try {
    return await work(access);
  } finally {
    await access.release();
  }
}
