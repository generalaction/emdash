import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { tasks } from '@core/services/app-db/node/schema';
import { checkoutSelector, gitErrorMessage } from '@core/services/runtime-broker/node/git';
import type { McpToolDependencies } from './dependencies';

export type WorkspaceRuntime = Readonly<{
  client: HostRuntimesClient;
  /** Native path of the worktree on its own host. */
  path: string;
}>;

/** Resolves a task's workspace id, or a caller-facing reason it has none. */
export async function resolveTaskWorkspaceId(
  dependencies: McpToolDependencies,
  input: { projectId: string; taskId: string }
): Promise<Result<string, string>> {
  const [row] = await dependencies.db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(
      and(eq(tasks.id, input.taskId), eq(tasks.projectId, input.projectId), isNull(tasks.deletedAt))
    )
    .limit(1);
  if (!row) return err(`Task not found in project ${input.projectId}: ${input.taskId}`);
  if (!row.workspaceId) {
    return err(`Task ${input.taskId} has no workspace yet`);
  }
  return ok(row.workspaceId);
}

/**
 * Resolves the runtime client for whichever host owns a workspace, so callers
 * work the same for a local worktree and one on a remote workspace server.
 */
export async function resolveWorkspaceRuntime(
  dependencies: McpToolDependencies,
  workspaceId: string
): Promise<Result<WorkspaceRuntime, string>> {
  const identity = await dependencies.workspaceIdentity.resolve(workspaceId);
  if (!identity) return err(`Workspace ${workspaceId} is no longer known`);
  const client = await dependencies.runtimes.client(identity.host);
  if (!client.success) {
    return err(`The task's host is unavailable (${client.error.type})`);
  }
  return ok({ client: client.data, path: identity.path });
}

export type WorktreeChangeCounts = Readonly<{
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}>;

export type WorktreeChangesState =
  | { kind: 'clean' }
  /**
   * `counts` is null when the worktree is known to hold work but the per-kind
   * tally is not available: git declined to enumerate an oversized working set,
   * or the fresh diff saw a change the watcher-backed summary had not caught up
   * to yet.
   */
  | { kind: 'dirty'; counts: WorktreeChangeCounts | null }
  /** The worktree could not be inspected, so its state is not known either way. */
  | { kind: 'unknown'; reason: string };

/**
 * Reads a worktree's uncommitted-change state from git on whichever host owns
 * it, as freshly as the runtime allows.
 *
 * The workspace registry mirror also carries a `dirty` flag, but it is only as
 * fresh as the last host scan and is the wrong source for a destructive gate: an
 * agent that writes files and immediately asks to delete the task would be
 * checked against an observation that predates its own edits.
 *
 * Two reads, because neither is both fresh and complete:
 *
 * - the `status` live state runs `git status -uall`, so it is the only exposed
 *   read that reports untracked files, but it is recomputed by a filesystem
 *   watcher and so can lag a just-written file by the watcher's latency.
 * - `getChangedFiles` is a direct `git diff` with no cache in front of it, so it
 *   always reflects the current tracked-file state, but being a diff it never
 *   reports untracked files.
 *
 * Either read reporting work means dirty; only agreement on "nothing" is clean.
 * Anything unreadable is `unknown`, never clean, so the gate fails closed.
 */
export async function inspectWorktreeChanges(
  dependencies: McpToolDependencies,
  workspaceId: string
): Promise<WorktreeChangesState> {
  const runtime = await resolveWorkspaceRuntime(dependencies, workspaceId);
  if (!runtime.success) return { kind: 'unknown', reason: runtime.error };

  const { client, path } = runtime.data;
  const checkout = checkoutSelector(path);
  let status: Awaited<ReturnType<ReturnType<typeof client.git.checkout.model.state>['snapshot']>>;
  let changed: Awaited<ReturnType<typeof client.git.checkout.getChangedFiles>>;
  try {
    [status, changed] = await Promise.all([
      client.git.checkout.model.state(checkout, 'status').snapshot(),
      client.git.checkout.getChangedFiles({ ...checkout, target: { kind: 'working-vs-head' } }),
    ]);
  } catch (error) {
    // A checkout that cannot even be opened (moved, deleted, never a repo)
    // rejects rather than reporting an error state.
    return { kind: 'unknown', reason: gitErrorMessage(error) };
  }

  if (!changed.success) return { kind: 'unknown', reason: gitErrorMessage(changed.error) };
  const changedTrackedFiles = changed.data.files.length;

  if (status.data.kind === 'too-many-files') {
    // Git gave up enumerating, which only happens with a very large working
    // set; that is emphatically not clean.
    return { kind: 'dirty', counts: null };
  }
  if (status.data.kind !== 'ok') {
    return { kind: 'unknown', reason: status.data.message };
  }

  const { staged, unstaged, conflicted, untracked } = status.data.summary;
  const counts = { staged, unstaged, untracked, conflicted };
  if (staged + unstaged + conflicted + untracked > 0) return { kind: 'dirty', counts };
  // The summary says clean, but it is the stale one of the two reads.
  if (changedTrackedFiles > 0) return { kind: 'dirty', counts: null };
  return { kind: 'clean' };
}
