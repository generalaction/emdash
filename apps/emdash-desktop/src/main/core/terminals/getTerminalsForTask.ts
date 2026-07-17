import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { terminals } from '@main/db/schema';
import { type Terminal } from '@shared/core/terminals/terminals';
import { mapTerminalRowToTerminal } from './core';

export async function getTerminalsForTask(projectId: string, taskId: string): Promise<Terminal[]> {
  const rows = await db.select().from(terminals).where(eq(terminals.taskId, taskId));
  return rows.map(mapTerminalRowToTerminal);
}
