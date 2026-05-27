import { and, eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { terminals } from '@main/db/schema';
import { resolveTask } from '../projects/utils';
import { mapTerminalRowToTerminal } from './core';

export async function hydrateTerminal({
  projectId,
  taskId,
  terminalId,
}: {
  projectId: string;
  taskId: string;
  terminalId: string;
}): Promise<void> {
  const task = resolveTask(projectId, taskId);
  if (!task) throw new Error('Task not found');

  const [row] = await db
    .select()
    .from(terminals)
    .where(
      and(
        eq(terminals.id, terminalId),
        eq(terminals.projectId, projectId),
        eq(terminals.taskId, taskId)
      )
    )
    .limit(1);
  if (!row) throw new Error('Terminal not found');

  await task.terminals.spawnTerminal(mapTerminalRowToTerminal(row));
}
