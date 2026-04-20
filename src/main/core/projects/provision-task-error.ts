import type { ProvisionTaskError } from './project-provider';
import type { ServeWorktreeError } from './worktrees/worktree-service';

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
