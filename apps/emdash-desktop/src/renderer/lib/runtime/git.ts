import type { HostAbsolutePath, PortableRelativePath } from '@emdash/core/primitives/path/api';
import { gitContract, type CheckoutHeadState } from '@emdash/core/runtimes/git/api';
import { err, ok, type Result } from '@emdash/shared';
import {
  createLiveModelReplica,
  createLiveJobReplica,
  LiveJobFailedError,
  type JobError,
  type JobInput,
  type JobProgress,
  type JobResult,
  type LiveJobClientHandle,
  type LiveJobEndpointDef,
} from '@emdash/wire';
import { hostPathFromNative, portablePath } from '@shared/core/runtime/paths';
import { getGitRuntimeClient } from './git-client';

export function repositorySelector(nativePath: string): { repository: HostAbsolutePath } {
  return { repository: hostPathFromNative(nativePath) };
}

export function checkoutSelector(nativePath: string): { checkout: HostAbsolutePath } {
  return { checkout: hostPathFromNative(nativePath) };
}

export function gitFilePath(relativePath: string): PortableRelativePath {
  return portablePath(relativePath.replaceAll('\\', '/'));
}

export async function readCheckoutHead(nativePath: string): Promise<CheckoutHeadState> {
  const client = await getGitRuntimeClient();
  const replica = createLiveModelReplica(gitContract.checkout.model, client.checkout.model);
  const lease = replica.acquire(checkoutSelector(nativePath));
  try {
    const model = await lease.ready();
    return model.states.head.current();
  } finally {
    await lease.release();
    await replica.dispose();
  }
}

export async function runRuntimeJob<Def extends LiveJobEndpointDef>(
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
