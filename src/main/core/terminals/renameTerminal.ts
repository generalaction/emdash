import { eq, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { terminals } from '@main/db/schema';

export async function renameTerminal(terminalId: string, name: string) {
  await db
    .update(terminals)
    .set({ name, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(terminals.id, terminalId));
}
