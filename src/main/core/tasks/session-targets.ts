import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations, terminals } from '@main/db/schema';

export type TaskSessionLeafIds = {
  conversationIds: string[];
  terminalIds: string[];
};

export async function getTaskSessionLeafIds(
  projectId: string,
  taskId: string
): Promise<TaskSessionLeafIds> {
  const [conversationRows, terminalRows] = await Promise.all([
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.projectId, projectId), eq(conversations.taskId, taskId))),
    db
      .select({ id: terminals.id })
      .from(terminals)
      .where(and(eq(terminals.projectId, projectId), eq(terminals.taskId, taskId))),
  ]);

  return {
    conversationIds: conversationRows.map((row) => row.id),
    terminalIds: terminalRows.map((row) => row.id),
  };
}
