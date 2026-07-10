import { toGitCommandError, type GitCommandError } from '@emdash/core/git';
import { err, ok, type PendingLease, type Result } from '@emdash/shared';

export async function withLease<Handle, T>(
  lease: PendingLease<Handle>,
  run: (handle: Handle) => Promise<T>
): Promise<T> {
  try {
    return await run(await lease.ready());
  } finally {
    await lease.release();
  }
}

export async function withLeaseValue<Handle, T>(
  lease: PendingLease<Handle>,
  run: (handle: Handle) => Promise<T>
): Promise<Result<T, GitCommandError>> {
  try {
    return ok(await withLease(lease, run));
  } catch (error) {
    return err(toGitCommandError(error));
  }
}

export async function withLeaseResult<Handle, T>(
  lease: PendingLease<Handle>,
  run: (handle: Handle) => Promise<Result<T, GitCommandError>>
): Promise<Result<T, GitCommandError>> {
  try {
    return await withLease(lease, run);
  } catch (error) {
    return err(toGitCommandError(error));
  }
}

export function toJobError(error: unknown): GitCommandError {
  return toGitCommandError(error);
}
