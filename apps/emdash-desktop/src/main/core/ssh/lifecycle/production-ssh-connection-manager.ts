import { eq } from 'drizzle-orm';
import { sshEvents } from '@core/features/ssh/node';
import { db } from '@main/db/client';
import { sshConnections } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { resolveProductionSshConnectConfig } from '../connect/production-connect-config';
import { SshConnectionManager } from './ssh-connection-manager';

export const sshConnectionManager = new SshConnectionManager({
  loadConnectionRow: async (id) => {
    const [row] = await db.select().from(sshConnections).where(eq(sshConnections.id, id)).limit(1);
    return row;
  },
  resolveConnectConfig: async (row) =>
    await resolveProductionSshConnectConfig({ kind: 'persisted', row }),
  publishEvent: (event) => sshEvents.emit(undefined, event),
  log,
});
