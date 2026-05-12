import { eq, sql } from 'drizzle-orm';
import { terminalUpdatedChannel } from '@shared/events/terminalEvents';
import { db } from '@main/db/client';
import { terminals } from '@main/db/schema';
import { events } from '@main/lib/events';
import { mapTerminalRowToTerminal } from './core';

export async function renameTerminal(terminalId: string, name: string) {
  const [updatedRow] = await db
    .update(terminals)
    .set({ name, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(terminals.id, terminalId))
    .returning();

  if (updatedRow) {
    events.emit(terminalUpdatedChannel, mapTerminalRowToTerminal(updatedRow));
  }
}
