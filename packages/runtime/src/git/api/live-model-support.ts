import type { GitCommandError } from '@emdash/core/git';
import { err, ok, toPendingLease, type Lease, type PendingLease } from '@emdash/shared';
import type { LiveCursorEntry, LiveModelDef, LiveMutationResult, LiveSource } from '@emdash/wire';
import type { GitExecution } from '../allocation/repository-mount';

export type UntypedMutationEnvelope<Key> = {
  key: Key;
  input: unknown;
  mutationId: string;
};

export function liveResult<T, E>(
  execution: GitExecution<T, E>,
  contract: LiveModelDef,
  key: unknown
): LiveMutationResult<T, E> {
  if (!execution.result.success) return err(execution.result.error);
  const cursors: LiveCursorEntry[] = [];
  for (const settled of execution.settled) {
    const state = contract.states[settled.name];
    if (!state) continue;
    cursors.push({ model: state.id, key, cursor: settled.cursor });
  }
  return ok({ data: execution.result.data, cursors });
}

export function acquireHandleSource<T>(
  handleLease: PendingLease<T>,
  source: (handle: T) => Promise<LiveSource>
): PendingLease<LiveSource> {
  return toPendingLease(
    (async (): Promise<Lease<LiveSource>> => {
      try {
        const handle = await handleLease.ready();
        return { value: await source(handle), release: () => handleLease.release() };
      } catch (error) {
        await handleLease.release();
        throw error;
      }
    })()
  );
}

export async function withHandleMutation<T, D, E>(
  lease: PendingLease<T>,
  run: (handle: T) => Promise<LiveMutationResult<D, E>>
): Promise<LiveMutationResult<D, E | GitCommandError>> {
  try {
    return await run(await lease.ready());
  } catch (error) {
    return err(toGitError(error));
  } finally {
    await lease.release();
  }
}

function toGitError(error: unknown): GitCommandError {
  if (error && typeof error === 'object' && 'resolution' in error) {
    const resolution = (error as { resolution?: { message?: unknown } }).resolution;
    if (typeof resolution?.message === 'string') {
      return { type: 'git_error', message: resolution.message };
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return { type: 'git_error', message };
}
