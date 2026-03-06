import { db } from '@/db/client';
import { terminals } from '@/db/schema';
import { createRPCController } from '@shared/ipc/rpc';
import { count, eq } from 'drizzle-orm';

export const terminalsController = createRPCController({
  createTerminal: async (taskId: string, name?: string) => {
    const terminalId = crypto.randomUUID();
    await db.insert(terminals).values({
      id: terminalId,
      taskId,
      name:
        name ||
        `Terminal ${await db
          .select({ count: count() })
          .from(terminals)
          .where(eq(terminals.taskId, taskId))
          .then((result) => result[0].count)}`,
    });

    // spawn a pty for the terminal
    return terminalId;
  },
  getTerminals: async (taskId: string) => {
    return await db.select().from(terminals).where(eq(terminals.taskId, taskId));
  },
  deleteTerminal: async (terminalId: string) => {
    await db.delete(terminals).where();
  },
  renameTerminal: async (terminalId: string, name: string) => {},
});
