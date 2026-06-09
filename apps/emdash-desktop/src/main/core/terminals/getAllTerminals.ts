import { eq, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { tasks, terminals } from '@main/db/schema';
import type { Terminal } from '@shared/core/terminals/terminals';
import { mapTerminalRowToTerminal } from './core';

export async function getAllTerminals(): Promise<Terminal[]> {
  const rows = await db
    .select({ terminal: terminals })
    .from(terminals)
    .innerJoin(tasks, eq(terminals.taskId, tasks.id))
    .where(isNull(tasks.archivedAt));
  return rows.map(({ terminal }) => mapTerminalRowToTerminal(terminal));
}
