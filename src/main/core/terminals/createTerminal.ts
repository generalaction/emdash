import { sql } from 'drizzle-orm';
import { terminalCreatedChannel } from '@shared/events/terminalEvents';
import type { CreateTerminalParams, Terminal } from '@shared/terminals';
import { db } from '@main/db/client';
import { terminals } from '@main/db/schema';
import { events } from '@main/lib/events';
import { telemetryService } from '@main/lib/telemetry';
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

  const terminal = mapTerminalRowToTerminal(row);
  await task.terminals.spawnTerminal(terminal, initialSize);
  events.emit(terminalCreatedChannel, terminal);
  telemetryService.capture('terminal_created', {
    terminal_id: terminalId,
    project_id: params.projectId,
    task_id: params.taskId,
  });

  return terminal;
}
