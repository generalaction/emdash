import type { WorkspaceKind, WorkspaceType } from '@shared/workspaces';

type WorkspaceRow = {
  kind: WorkspaceKind | null | undefined;
  type: WorkspaceType;
  path: string | null | undefined;
};

/**
 * Derives a `WorkspaceKind` for a workspace row, falling back to inference
 * from legacy columns when `kind` is null (i.e. pre-migration rows).
 *
 * This is a retrieval-path compatibility helper — it must never be used to
 * backfill or write values; new rows should always set `kind` explicitly.
 */
export function resolveWorkspaceKind(row: WorkspaceRow): WorkspaceKind {
  if (row.kind) return row.kind;

  // Legacy inference from workspace type and path presence.
  if (row.type === 'byoi') return 'byoi';

  // Local/SSH workspaces with a resolved path are either a worktree or a
  // project-root.  We cannot distinguish them without additional context, so
  // we default to 'worktree' which covers the common case.
  return 'worktree';
}
