import { basename } from 'node:path';
import { eq } from 'drizzle-orm';
import { projects, sshConnections } from '@main/db/schema';
import { log } from '@main/lib/logger';
import {
  makeSshFingerprint,
  normalizePort,
  normalizeRemotePath,
} from '../../legacy-source/normalize';
import {
  localProjectIdentityKey,
  sshProjectIdentityKey,
} from '../../legacy-source/project-identity';
import {
  isUniqueConstraintError,
  readLegacyRows,
  toInteger,
  toIsoTimestamp,
  toTrimmedString,
} from './helpers';
import { insertWithRegeneratedId } from './insert';
import { createPortSummary, type PortContext, type PortSummary } from './types';

type ExistingProjectRow = {
  id: string;
  path: string;
  workspaceProvider: string;
  sshConnectionId: string | null;
  host: string | null;
  port: number | null;
  username: string | null;
};

type ConnectionFingerprintRow = {
  id: string;
  host: string;
  port: number;
  username: string;
};

function pickDefaultProjectName(projectPath: string, fallbackId: string): string {
  const derived = basename(projectPath.trim());
  return derived.length > 0 ? derived : `Legacy Project ${fallbackId.slice(0, 8)}`;
}

async function loadConnectionFingerprintById(
  appDb: PortContext['appDb']
): Promise<Map<string, string>> {
  const rows = (await appDb
    .select({
      id: sshConnections.id,
      host: sshConnections.host,
      port: sshConnections.port,
      username: sshConnections.username,
    })
    .from(sshConnections)
    .execute()) as ConnectionFingerprintRow[];

  const result = new Map<string, string>();
  for (const row of rows) {
    result.set(row.id, makeSshFingerprint(row.host, normalizePort(row.port), row.username));
  }
  return result;
}

export async function portProjects({
  appDb,
  legacyDb,
  remap,
  skipLegacyProjectIds,
}: PortContext & {
  skipLegacyProjectIds?: ReadonlySet<string>;
}): Promise<PortSummary> {
  const summary = createPortSummary('projects');
  const nowIso = new Date().toISOString();

  const existingProjectRows = (await appDb
    .select({
      id: projects.id,
      path: projects.path,
      workspaceProvider: projects.workspaceProvider,
      sshConnectionId: projects.sshConnectionId,
      host: sshConnections.host,
      port: sshConnections.port,
      username: sshConnections.username,
    })
    .from(projects)
    .leftJoin(sshConnections, eq(projects.sshConnectionId, sshConnections.id))
    .execute()) as ExistingProjectRow[];

  const projectIds = new Set<string>();
  const localKeyToProjectId = new Map<string, string>();
  const sshKeyToProjectId = new Map<string, string>();

  for (const row of existingProjectRows) {
    projectIds.add(row.id);

    if (row.workspaceProvider === 'ssh' && row.sshConnectionId && row.host && row.username) {
      const fingerprint = makeSshFingerprint(row.host, normalizePort(row.port), row.username);
      sshKeyToProjectId.set(sshProjectIdentityKey(fingerprint, row.path), row.id);
      continue;
    }

    localKeyToProjectId.set(localProjectIdentityKey(row.path), row.id);
  }

  const connectionFingerprintById = await loadConnectionFingerprintById(appDb);

  const legacyRows = readLegacyRows(legacyDb, 'projects', [
    'id',
    'name',
    'path',
    'base_ref',
    'is_remote',
    'remote_path',
    'ssh_connection_id',
    'created_at',
    'updated_at',
  ]);

  for (const row of legacyRows) {
    summary.considered += 1;

    const legacyProjectId = toTrimmedString(row.id);
    if (!legacyProjectId) {
      summary.skippedInvalid += 1;
      log.warn('legacy-port: projects: skipping invalid row (missing id)');
      continue;
    }

    if (skipLegacyProjectIds?.has(legacyProjectId)) {
      summary.skippedDedup += 1;
      continue;
    }

    const isRemote = toInteger(row.is_remote) === 1;
    const createdAt = toIsoTimestamp(row.created_at, nowIso);
    const updatedAt = toIsoTimestamp(row.updated_at, nowIso);

    let workspaceProvider: 'local' | 'ssh' = 'local';
    let mappedSshConnectionId: string | null = null;
    let projectPath: string | undefined;
    let dedupKey: string | undefined;

    if (isRemote) {
      workspaceProvider = 'ssh';

      const legacySshConnectionId = toTrimmedString(row.ssh_connection_id);
      const remotePath = toTrimmedString(row.remote_path);
      if (!legacySshConnectionId || !remotePath) {
        summary.skippedInvalid += 1;
        log.warn('legacy-port: projects: skipping SSH row missing remote_path/ssh_connection_id', {
          legacyProjectId,
        });
        continue;
      }

      mappedSshConnectionId = remap.sshConnectionId.get(legacySshConnectionId) ?? null;
      if (!mappedSshConnectionId) {
        summary.skippedInvalid += 1;
        log.warn(
          'legacy-port: projects: skipping SSH row with unresolved ssh_connection_id remap',
          {
            legacyProjectId,
            legacySshConnectionId,
          }
        );
        continue;
      }

      const normalizedRemotePath = normalizeRemotePath(remotePath);
      if (!normalizedRemotePath) {
        summary.skippedInvalid += 1;
        log.warn('legacy-port: projects: skipping SSH row with invalid remote_path', {
          legacyProjectId,
        });
        continue;
      }

      const fingerprint = connectionFingerprintById.get(mappedSshConnectionId);
      if (!fingerprint) {
        summary.skippedInvalid += 1;
        log.warn('legacy-port: projects: skipping SSH row with unknown connection fingerprint', {
          legacyProjectId,
          mappedSshConnectionId,
        });
        continue;
      }

      projectPath = remotePath;
      dedupKey = sshProjectIdentityKey(fingerprint, normalizedRemotePath);

      const existingProjectId = sshKeyToProjectId.get(dedupKey);
      if (existingProjectId) {
        remap.projectId.set(legacyProjectId, existingProjectId);
        summary.skippedDedup += 1;
        continue;
      }
    } else {
      const localPath = toTrimmedString(row.path);
      if (!localPath) {
        summary.skippedInvalid += 1;
        log.warn('legacy-port: projects: skipping local row with missing path', {
          legacyProjectId,
        });
        continue;
      }

      projectPath = localPath;
      dedupKey = localProjectIdentityKey(localPath);

      const existingProjectId = localKeyToProjectId.get(dedupKey);
      if (existingProjectId) {
        remap.projectId.set(legacyProjectId, existingProjectId);
        summary.skippedDedup += 1;
        continue;
      }
    }

    if (!projectPath || !dedupKey) {
      summary.skippedInvalid += 1;
      continue;
    }

    const insertValues = {
      id: legacyProjectId,
      name: toTrimmedString(row.name) ?? pickDefaultProjectName(projectPath, legacyProjectId),
      path: projectPath,
      workspaceProvider,
      baseRef: toTrimmedString(row.base_ref) ?? null,
      sshConnectionId: mappedSshConnectionId,
      createdAt,
      updatedAt,
    };

    const insertResult = await insertWithRegeneratedId({
      initialId: legacyProjectId,
      existingIds: projectIds,
      uniqueConstraintDetail: 'projects.id',
      setId: (id) => {
        insertValues.id = id;
      },
      insert: () => appDb.insert(projects).values(insertValues).execute(),
    });

    if (!insertResult.inserted) {
      if (isUniqueConstraintError(insertResult.error, 'projects.path')) {
        const [existingByPath] = await appDb
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.path, projectPath))
          .limit(1)
          .execute();

        if (existingByPath) {
          remap.projectId.set(legacyProjectId, existingByPath.id);
          summary.skippedDedup += 1;
        } else {
          summary.skippedError += 1;
          log.warn('legacy-port: projects: path conflict but no surviving row found', {
            legacyProjectId,
            projectPath,
          });
        }
      } else {
        summary.skippedError += 1;
        log.warn('legacy-port: projects: failed to insert row', {
          legacyProjectId,
          error:
            insertResult.error instanceof Error
              ? insertResult.error.message
              : String(insertResult.error),
        });
      }
      continue;
    }

    remap.projectId.set(legacyProjectId, insertResult.id);
    projectIds.add(insertResult.id);
    summary.inserted += 1;

    if (workspaceProvider === 'ssh') {
      const fingerprint = mappedSshConnectionId
        ? connectionFingerprintById.get(mappedSshConnectionId)
        : undefined;
      if (fingerprint) {
        sshKeyToProjectId.set(sshProjectIdentityKey(fingerprint, projectPath), insertResult.id);
      }
    } else {
      localKeyToProjectId.set(localProjectIdentityKey(projectPath), insertResult.id);
    }
  }

  return summary;
}
