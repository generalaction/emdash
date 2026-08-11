import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { projects, sshConnections, workspaces } from '@core/services/app-db/node/schema';
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
  path: string | null;
  location: 'local' | 'remote' | null;
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

/**
 * Finds or creates the live repository workspace row that will own the
 * imported project's path + host identity. Returns undefined on failure.
 */
async function resolveRepositoryWorkspace(
  appDb: PortContext['appDb'],
  input: {
    path: string;
    location: 'local' | 'remote';
    sshConnectionId: string | null;
    createdAt: string;
    updatedAt: string;
  }
): Promise<string | undefined> {
  const pathScope = and(
    isNull(workspaces.untrackedAt),
    eq(workspaces.location, input.location),
    eq(workspaces.path, input.path),
    input.location === 'remote' && input.sshConnectionId
      ? eq(workspaces.sshConnectionId, input.sshConnectionId)
      : undefined
  );
  const [existing] = await appDb
    .select({ id: workspaces.id, kind: workspaces.kind })
    .from(workspaces)
    .where(pathScope)
    .limit(1)
    .execute();
  if (existing) {
    if (existing.kind !== 'repository') {
      await appDb
        .update(workspaces)
        .set({ kind: 'repository', updatedAt: input.updatedAt })
        .where(eq(workspaces.id, existing.id))
        .execute();
    }
    return existing.id;
  }

  const workspaceId = randomUUID();
  try {
    await appDb
      .insert(workspaces)
      .values({
        id: workspaceId,
        type: input.location === 'remote' ? 'project-ssh' : 'local',
        kind: 'repository',
        location: input.location,
        sshConnectionId: input.location === 'remote' ? input.sshConnectionId : null,
        path: input.path,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      })
      .execute();
    return workspaceId;
  } catch (error) {
    // Unique path index race (SQLite names the partial index): another row won — reuse it.
    if (isUniqueConstraintError(error, 'idx_workspaces')) {
      const [raced] = await appDb
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(pathScope)
        .limit(1)
        .execute();
      if (raced) return raced.id;
    }
    log.warn('legacy-port: projects: repository workspace insert failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
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
      path: workspaces.path,
      location: workspaces.location,
      sshConnectionId: workspaces.sshConnectionId,
      host: sshConnections.host,
      port: sshConnections.port,
      username: sshConnections.username,
    })
    .from(projects)
    .leftJoin(workspaces, eq(workspaces.id, projects.repositoryWorkspaceId))
    .leftJoin(sshConnections, eq(workspaces.sshConnectionId, sshConnections.id))
    .execute()) as ExistingProjectRow[];

  const projectIds = new Set<string>();
  const localKeyToProjectId = new Map<string, string>();
  const sshKeyToProjectId = new Map<string, string>();

  for (const row of existingProjectRows) {
    projectIds.add(row.id);
    if (!row.path) continue;

    if (row.location === 'remote' && row.sshConnectionId && row.host && row.username) {
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

    const repositoryWorkspaceId = await resolveRepositoryWorkspace(appDb, {
      path: projectPath,
      location: workspaceProvider === 'ssh' ? 'remote' : 'local',
      sshConnectionId: mappedSshConnectionId,
      createdAt,
      updatedAt,
    });
    if (!repositoryWorkspaceId) {
      summary.skippedError += 1;
      log.warn('legacy-port: projects: failed to create repository workspace row', {
        legacyProjectId,
        projectPath,
      });
      continue;
    }

    const insertValues = {
      id: legacyProjectId,
      name: toTrimmedString(row.name) ?? pickDefaultProjectName(projectPath, legacyProjectId),
      baseRef: toTrimmedString(row.base_ref) ?? null,
      repositoryWorkspaceId,
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
      summary.skippedError += 1;
      log.warn('legacy-port: projects: failed to insert row', {
        legacyProjectId,
        error:
          insertResult.error instanceof Error
            ? insertResult.error.message
            : String(insertResult.error),
      });
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
