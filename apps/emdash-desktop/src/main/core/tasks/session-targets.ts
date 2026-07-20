import { and, eq } from 'drizzle-orm';
import { conversations, terminals } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';

export type TaskSessionLeafIds = {
  conversationIds: string[];
  terminalIds: string[];
};

export async function getTaskSessionLeafIds(
  projectId: string,
  taskId: string
): Promise<TaskSessionLeafIds> {
  const [conversationRows, terminalRows] = await Promise.all([
    getAppDb()
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.projectId, projectId), eq(conversations.taskId, taskId))),
    getAppDb()
      .select({ id: terminals.id })
      .from(terminals)
      .where(and(eq(terminals.projectId, projectId), eq(terminals.taskId, taskId))),
  ]);

  return {
    conversationIds: conversationRows.map((row) => row.id),
    terminalIds: terminalRows.map((row) => row.id),
  };
}

/**
 * All conversation and terminal leaf ids for a project, across every task.
 * Used by the tmux reaper to compute the set of PTY sessions that are still
 * "wanted" — a tmux session whose leaf id is absent here no longer maps to any
 * DB-tracked entity and is safe to reap. No archived filter on purpose: keep the
 * wanted set as broad as possible so a still-resumable session is never reaped.
 */
export async function getProjectSessionLeafIds(projectId: string): Promise<TaskSessionLeafIds> {
  const [conversationRows, terminalRows] = await Promise.all([
    getAppDb()
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.projectId, projectId)),
    getAppDb()
      .select({ id: terminals.id })
      .from(terminals)
      .where(eq(terminals.projectId, projectId)),
  ]);

  return {
    conversationIds: conversationRows.map((row) => row.id),
    terminalIds: terminalRows.map((row) => row.id),
  };
}
