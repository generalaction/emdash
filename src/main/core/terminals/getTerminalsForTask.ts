import { eq } from 'drizzle-orm';
import { Terminal } from '@shared/terminals';
import { db } from '@main/db/client';
import { terminals } from '@main/db/schema';
import { mapTerminalRowToTerminal } from './core';

export async function getTerminalsForTask(projectId: string, taskId: string): Promise<Terminal[]> {
  const rows = await db.select().from(terminals).where(eq(terminals.taskId, taskId));
  return rows.map(mapTerminalRowToTerminal);
}
