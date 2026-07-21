import type { PortableRelativePath } from '@emdash/core/primitives/path/api';
import type { CheckoutHeadState } from '@emdash/core/runtimes/git/api';
import { err, ok, type Result } from '@emdash/shared';
import {
  createLiveJobReplica,
  createLiveModelReplica,
  LiveJobFailedError,
  type JobError,
  type JobInput,
  type JobProgress,
  type JobResult,
  type LiveJobClientHandle,
  type LiveJobEndpointDef,
} from '@emdash/wire';
import { portablePath } from '@core/primitives/desktop-runtime/api';
import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';
import { sourceControlContract } from '..';

export type SourceControlClient = DesktopWireClient['sourceControl'];

export async function getSourceControlClient(): Promise<SourceControlClient> {
  return (await getDesktopWireClient()).sourceControl;
}

export function resetSourceControlClient(): void {
  resetDesktopWireClient();
}

export function repositorySelector(projectId: string): { projectId: string } {
  return { projectId };
}

export function checkoutSelector(workspaceId: string): { workspaceId: string } {
  return { workspaceId };
}

export function gitFilePath(relativePath: string): PortableRelativePath {
  return portablePath(relativePath.replaceAll('\\', '/'));
}

export async function readCheckoutHead(workspaceId: string): Promise<CheckoutHeadState> {
  const client = await getSourceControlClient();
  const replica = createLiveModelReplica(
    sourceControlContract.checkout.model,
    client.checkout.model
  );
  const lease = replica.acquire(checkoutSelector(workspaceId));
  try {
    const model = await lease.ready();
    return model.states.head.current();
  } finally {
    await lease.release();
    await replica.dispose();
  }
}

export async function runSourceControlJob<Def extends LiveJobEndpointDef>(
  definition: Def,
  handle: LiveJobClientHandle<Def>,
  input: JobInput<Def>,
  onProgress?: (progress: JobProgress<Def>) => void
): Promise<Result<JobResult<Def>, JobError<Def>>> {
  const jobs = createLiveJobReplica(definition, handle);
  const lease = await jobs.start(input);
  try {
    const job = await lease.ready();
    const unsubscribe = onProgress ? job.onProgress(onProgress) : undefined;
    try {
      return ok(await job.result);
    } catch (error) {
      if (error instanceof LiveJobFailedError) return err(error.error as JobError<Def>);
      throw error;
    } finally {
      unsubscribe?.();
    }
  } finally {
    await lease.release();
    await jobs.dispose();
  }
}
