import type { LegacyWorkspaceAutomation } from '@emdash/core/runtimes/workspace/api';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { db } from '@main/db/client';
import {
  conversations,
  terminals,
  type LifecycleOperationRow,
  type ProjectRow,
  type TaskRow,
  type WorkspaceRow,
} from '@main/db/schema';
import { resolveOperationContext } from '../operation-context';

export type TaskOperationProbe = {
  task?: TaskRow;
  workspace?: WorkspaceRow;
  project?: ProjectRow;
  automation?: LegacyWorkspaceAutomation;
  acpConversationCount: number;
  tuiConversationCount: number;
  terminalCount: number;
};

export async function probeTaskState(
  operation: LifecycleOperationRow
): Promise<TaskOperationProbe> {
  const context = await resolveOperationContext(operation, { resolveRuntimeConfig: true });
  if (!context.task) {
    return {
      ...context,
      acpConversationCount: 0,
      tuiConversationCount: 0,
      terminalCount: 0,
    };
  }

  const { task } = context;
  const [acpRows, tuiRows, terminalRows] = await Promise.all([
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.taskId, task.id), eq(conversations.type, 'acp'))),
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.taskId, task.id),
          or(ne(conversations.type, 'acp'), isNull(conversations.type))
        )
      ),
    db.select({ id: terminals.id }).from(terminals).where(eq(terminals.taskId, task.id)),
  ]);

  return {
    ...context,
    acpConversationCount: acpRows.length,
    tuiConversationCount: tuiRows.length,
    terminalCount: terminalRows.length,
  };
}
