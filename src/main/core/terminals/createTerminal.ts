import { eq, sql } from 'drizzle-orm';
import type { CreateTerminalParams, Terminal } from '@shared/terminals';
import { withCompensation } from '@main/core/utils/compensation';
import { db } from '@main/db/client';
import { terminals } from '@main/db/schema';
import { log } from '@main/lib/logger';
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
  await withCompensation({
    action: () => task.terminals.spawnTerminal(terminal, initialSize),
    compensate: async () => {
      await db.delete(terminals).where(eq(terminals.id, row.id)).execute();
    },
    onCompensationError: (error) => {
      log.error('createTerminal: failed to roll back terminal row after spawn failure', {
        terminalId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  telemetryService.capture('terminal_created', {
    terminal_id: terminalId,
    project_id: params.projectId,
    task_id: params.taskId,
  });

  return terminal;
}
