import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { sshConnections } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { sshConnectionEventChannel } from '@shared/events/sshEvents';
import { resolveProductionSshConnectConfig } from './production-connect-config';
import { SshConnectionManager } from './ssh-connection-manager';

export const sshConnectionManager = new SshConnectionManager({
  loadConnectionRow: async (id) => {
    const [row] = await db.select().from(sshConnections).where(eq(sshConnections.id, id)).limit(1);
    return row;
  },
  resolveConnectConfig: async (row) =>
    await resolveProductionSshConnectConfig({ kind: 'persisted', row }),
  publishEvent: (event) => events.emit(sshConnectionEventChannel, event),
  log,
});
