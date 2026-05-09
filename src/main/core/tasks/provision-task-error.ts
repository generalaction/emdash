import type { ProvisionStep } from '@shared/events/taskEvents';
import { TimeoutSignal } from '../projects/utils';
import type { ServeWorktreeError } from '../projects/worktrees/worktree-service';

export const TASK_TIMEOUT_MS = 600_000;
export const TEARDOWN_SCRIPT_WAIT_MS = 10_000;

export type ProvisionTaskError =
  | { type: 'timeout'; message: string; timeout: number; step: ProvisionStep | null }
  | { type: 'branch-not-found'; branch: string }
  | { type: 'worktree-setup-failed'; branch: string; message?: string }
  | { type: 'error'; message: string };

export type TeardownTaskError =
  | { type: 'timeout'; message: string; timeout: number }
  | { type: 'error'; message: string };

export function toProvisionError(
  e: unknown,
  step: ProvisionStep | null = null
): ProvisionTaskError {
  if (isProvisionTaskError(e)) return e;
  if (e instanceof TimeoutSignal)
    return { type: 'timeout', message: e.message, timeout: e.ms, step };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

export function toTeardownError(e: unknown): TeardownTaskError {
  if (e instanceof TimeoutSignal) return { type: 'timeout', message: e.message, timeout: e.ms };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

export function mapWorktreeErrorToProvisionError(
  branch: string,
  error: ServeWorktreeError
): ProvisionTaskError {
  switch (error.type) {
    case 'branch-not-found':
      return { type: 'branch-not-found', branch: error.branch };
    case 'worktree-setup-failed':
      return {
        type: 'worktree-setup-failed',
        branch,
        message: error.cause instanceof Error ? error.cause.message : String(error.cause),
      };
  }
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

export function formatProvisionTaskError(error: ProvisionTaskError): string {
  switch (error.type) {
    case 'timeout':
      return error.step ? `${error.message} (step: ${error.step})` : error.message;
    case 'error':
      return error.message;
    case 'branch-not-found':
      return `Branch "${error.branch}" was not found locally or on remote`;
    case 'worktree-setup-failed':
      return error.message
        ? `Failed to set up worktree for branch "${error.branch}": ${error.message}`
        : `Failed to set up worktree for branch "${error.branch}"`;
  }
}
