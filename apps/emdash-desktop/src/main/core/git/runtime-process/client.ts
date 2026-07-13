import type {
  CheckoutSelector,
  GitFilePath,
  RepositorySelector,
} from '@emdash/core/runtimes/git/api';
import { err, ok, type Result } from '@emdash/shared';
import {
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

export function repositorySelector(nativePath: string): RepositorySelector {
  return { repository: hostPathFromNative(nativePath) };
}

export function checkoutSelector(nativePath: string): CheckoutSelector {
  return { checkout: hostPathFromNative(nativePath) };
}

export function gitFilePath(relativePath: string): GitFilePath {
  return portablePath(relativePath.replaceAll('\\', '/')) as GitFilePath;
}

export async function mutationResult<Data, Error>(
  pending: Promise<Result<{ data: Data }, Error>>
): Promise<Result<Data, Error>> {
  const result = await pending;
  return result.success ? ok(result.data.data) : result;
}

export async function runGitJob<Def extends LiveJobEndpointDef>(
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

export function gitErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
    const type = (error as { type?: unknown }).type;
    if (typeof type === 'string') return type.replaceAll('_', ' ');
  }
  return String(error);
}
