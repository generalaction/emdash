import { TimeoutError } from '@emdash/shared/scheduling';
import { match, P } from 'ts-pattern';
import type { WorkspaceBootstrapStep } from '@core/features/workspaces/api';
import type { ServeWorktreeError } from '../projects/worktrees/worktree-service';

export const TASK_TIMEOUT_MS = 600_000;
export const TEARDOWN_SCRIPT_WAIT_MS = 10_000;

export type ProvisionTaskError =
  | { type: 'timeout'; message: string; timeout: number; step: WorkspaceBootstrapStep | null }
  | { type: 'branch-not-found'; branch: string }
  | { type: 'worktree-setup-failed'; branch: string; message?: string }
  | { type: 'error'; message: string };

export type TeardownTaskError =
  | { type: 'timeout'; message: string; timeout: number }
  | { type: 'error'; message: string };

export function toProvisionError(
  e: unknown,
  step: WorkspaceBootstrapStep | null = null
): ProvisionTaskError {
  if (isProvisionTaskError(e)) return e;
  if (e instanceof TimeoutError)
    return { type: 'timeout', message: e.message, timeout: e.durationMs, step };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

export function toTeardownError(e: unknown): TeardownTaskError {
  if (e instanceof TimeoutError)
    return { type: 'timeout', message: e.message, timeout: e.durationMs };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

export function mapWorktreeErrorToProvisionError(
  branch: string,
  error: ServeWorktreeError
): ProvisionTaskError {
  return match(error)
    .with({ type: 'branch-not-found' }, (e) => ({
      type: 'branch-not-found' as const,
      branch: e.branch,
    }))
    .with({ type: 'worktree-setup-failed' }, (e) => ({
      type: 'worktree-setup-failed' as const,
      branch,
      message: e.cause.message,
    }))
    .exhaustive();
}

export function isProvisionTaskError(e: unknown): e is ProvisionTaskError {
  if (!e || typeof e !== 'object' || !('type' in e)) return false;
  const type = (e as { type?: string }).type;
  return (
    type === 'timeout' ||
    type === 'error' ||
    type === 'branch-not-found' ||
    type === 'worktree-setup-failed'
  );
}

export function formatTeardownTaskError(error: TeardownTaskError): string {
  return match(error)
    .with(P.union({ type: 'timeout' }, { type: 'error' }), (e) => e.message)
    .exhaustive();
}

export function formatProvisionTaskError(error: ProvisionTaskError): string {
  return match(error)
    .with({ type: 'timeout' }, (e) => (e.step ? `${e.message} (step: ${e.step})` : e.message))
    .with({ type: 'error' }, (e) => e.message)
    .with(
      { type: 'branch-not-found' },
      (e) => `Branch "${e.branch}" was not found locally or on remote`
    )
    .with({ type: 'worktree-setup-failed' }, (e) =>
      e.message
        ? `Failed to set up worktree for branch "${e.branch}": ${e.message}`
        : `Failed to set up worktree for branch "${e.branch}"`
    )
    .exhaustive();
}
