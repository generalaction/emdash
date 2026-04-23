import { randomUUID } from 'node:crypto';
import { sshConnections } from '@main/db/schema';
import { log } from '@main/lib/logger';
import {
  makeSshFingerprint,
  normalizeHost,
  normalizePort,
  normalizeUsername,
} from '../../legacy-source/normalize';
import {
  isUniqueConstraintError,
  readLegacyRows,
  toInteger,
  toIsoTimestamp,
  toTrimmedString,
} from './helpers';
import { createPortSummary, type PortContext, type PortSummary } from './types';

type ExistingSshConnection = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
};

function pickUniqueConnectionName(baseName: string, usedNames: Set<string>): string {
  const trimmedBase = baseName.trim() || 'Legacy SSH';
  if (!usedNames.has(trimmedBase)) {
    usedNames.add(trimmedBase);
    return trimmedBase;
  }

  let index = 1;
  while (true) {
    const suffix = index === 1 ? ' (legacy)' : ` (legacy ${index})`;
    const candidate = `${trimmedBase}${suffix}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    index += 1;
  }
}

export async function portSshConnections({
  appDb,
  legacyDb,
  remap,
}: PortContext): Promise<PortSummary> {
  const summary = createPortSummary('ssh_connections');
  const nowIso = new Date().toISOString();

  const existingConnections = (await appDb
    .select({
      id: sshConnections.id,
      name: sshConnections.name,
      host: sshConnections.host,
      port: sshConnections.port,
      username: sshConnections.username,
    })
    .from(sshConnections)
    .execute()) as ExistingSshConnection[];

  const fingerprintToConnectionId = new Map<string, string>();
  const existingConnectionIds = new Set<string>();
  const usedConnectionNames = new Set<string>();

  for (const existing of existingConnections) {
    const fingerprint = makeSshFingerprint(
      existing.host,
      normalizePort(existing.port),
      existing.username
    );
    fingerprintToConnectionId.set(fingerprint, existing.id);
    existingConnectionIds.add(existing.id);
    usedConnectionNames.add(existing.name);
  }

  const legacyRows = readLegacyRows(legacyDb, 'ssh_connections', [
    'id',
    'name',
    'host',
    'port',
    'username',
    'auth_type',
    'private_key_path',
    'use_agent',
    'created_at',
    'updated_at',
  ]);

  for (const row of legacyRows) {
    summary.considered += 1;

    const legacyId = toTrimmedString(row.id);
    const host = toTrimmedString(row.host);
    const username = toTrimmedString(row.username);

    if (!legacyId || !host || !username) {
      summary.skippedInvalid += 1;
      log.warn('legacy-port: ssh_connections: skipping invalid row (missing id/host/username)', {
        legacyId,
      });
      continue;
    }

    const normalizedPort = normalizePort(toInteger(row.port));
    const fingerprint = makeSshFingerprint(host, normalizedPort, username);
    const existingConnectionId = fingerprintToConnectionId.get(fingerprint);

    if (existingConnectionId) {
      remap.sshConnectionId.set(legacyId, existingConnectionId);
      summary.skippedDedup += 1;
      continue;
    }

    let nextConnectionId = existingConnectionIds.has(legacyId) ? randomUUID() : legacyId;

    const preferredName =
      toTrimmedString(row.name) ??
      `${normalizeUsername(username)}@${normalizeHost(host)}:${normalizedPort}`;

    const insertValues = {
      id: nextConnectionId,
      name: pickUniqueConnectionName(preferredName, usedConnectionNames),
      host,
      port: normalizedPort,
      username,
      authType: toTrimmedString(row.auth_type) ?? 'agent',
      privateKeyPath: toTrimmedString(row.private_key_path) ?? null,
      useAgent: toInteger(row.use_agent) === 1 ? 1 : 0,
      metadata: null,
      createdAt: toIsoTimestamp(row.created_at, nowIso),
      updatedAt: toIsoTimestamp(row.updated_at, nowIso),
    };

    let inserted = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        insertValues.id = nextConnectionId;
        await appDb.insert(sshConnections).values(insertValues).execute();
        inserted = true;
        break;
      } catch (error) {
        if (attempt === 0 && isUniqueConstraintError(error, 'ssh_connections.id')) {
          nextConnectionId = randomUUID();
          continue;
        }

        summary.skippedError += 1;
        log.warn('legacy-port: ssh_connections: failed to insert row', {
          legacyId,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }

    if (!inserted) continue;

    remap.sshConnectionId.set(legacyId, nextConnectionId);
    fingerprintToConnectionId.set(fingerprint, nextConnectionId);
    existingConnectionIds.add(nextConnectionId);
    summary.inserted += 1;
  }

  return summary;
}
