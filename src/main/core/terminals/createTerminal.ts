import { sql } from 'drizzle-orm';
import type { CreateTerminalParams, Terminal } from '@shared/terminals';
import { db } from '@main/db/client';
import { terminals } from '@main/db/schema';
import { capture } from '@main/lib/telemetry';
import { resolveTask } from '../projects/utils';
import { mapTerminalRowToTerminal } from './core';

export async function createTerminal(params: CreateTerminalParams): Promise<Terminal> {
  const { id: terminalId, initialSize = { cols: 80, rows: 24 } } = params;

  const [row] = await db
    .insert(terminals)
    .values({
      id: terminalId,
      projectId: params.projectId,
      taskId: params.taskId,
      name: params.name,
      ssh: 0,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const task = resolveTask(params.projectId, params.taskId);
  if (!task) {
    throw new Error('Task not found');
  }

  await task.terminals.spawnTerminal(mapTerminalRowToTerminal(row), initialSize);
  capture('terminal_created', { project_id: params.projectId, task_id: params.taskId });

  return mapTerminalRowToTerminal(row);
}
