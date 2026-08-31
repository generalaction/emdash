import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { tasks } from '@core/services/app-db/node/schema';
import { checkoutSelector } from '@core/services/runtime-broker/node/git';
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
  /** `counts` is null when git declined to enumerate an oversized working set. */
  | { kind: 'dirty'; counts: WorktreeChangeCounts | null }
  /** The worktree could not be inspected, so its state is not known either way. */
  | { kind: 'unknown'; reason: string };

/**
 * Reads a worktree's uncommitted-change state from git, now.
 *
 * The workspace registry mirror also carries a `dirty` flag, but it is only as
 * fresh as the last host scan and is the wrong source for a destructive gate: an
 * agent that writes files and immediately asks to delete the task would be
 * checked against an observation that predates its own edits. This asks the
 * checkout directly, on whichever host owns it.
 */
export async function inspectWorktreeChanges(
  dependencies: McpToolDependencies,
  workspaceId: string
): Promise<WorktreeChangesState> {
  const runtime = await resolveWorkspaceRuntime(dependencies, workspaceId);
  if (!runtime.success) return { kind: 'unknown', reason: runtime.error };

  const status = await runtime.data.client.git.checkout.model
    .state(checkoutSelector(runtime.data.path), 'status')
    .snapshot();

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
  const total = staged + unstaged + conflicted + untracked;
  return total === 0 ? { kind: 'clean' } : { kind: 'dirty', counts };
}
