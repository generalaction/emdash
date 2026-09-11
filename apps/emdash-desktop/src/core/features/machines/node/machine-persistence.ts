import { eq, inArray } from 'drizzle-orm';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import {
  appSecrets,
  sshConnections,
  type SshConnectionInsert,
} from '@core/services/app-db/node/schema';
import { sshCredentialKeys } from '@core/services/ssh/node/credentials/credential-record';

export function captureMachineSave(db: AppDb | DrizzleTx, id: string) {
  return {
    connection: db.select().from(sshConnections).where(eq(sshConnections.id, id)).get(),
    credentials: db
      .select()
      .from(appSecrets)
      .where(inArray(appSecrets.key, Object.values(sshCredentialKeys(id))))
      .orderBy(appSecrets.key)
      .all(),
  };
}

export function persistMachine(
  db: AppDb,
  before: ReturnType<typeof captureMachineSave>,
  row: SshConnectionInsert,
  applyCredentials: (tx: DrizzleTx) => void,
  updatedAt: string
) {
  db.transaction((tx) => {
    if (JSON.stringify(captureMachineSave(tx, row.id)) !== JSON.stringify(before)) {
      throw new Error('This connection changed while saving. Reopen it and try again.');
    }
    tx.insert(sshConnections)
      .values(row)
      .onConflictDoUpdate({
        target: sshConnections.id,
        set: {
          name: row.name,
          host: row.host,
          port: row.port,
          metadata: row.metadata,
          username: row.username,
          authType: row.authType,
          privateKeyPath: row.privateKeyPath,
          useAgent: row.useAgent,
          updatedAt,
        },
      })
      .run();
    applyCredentials(tx);
  });
}
