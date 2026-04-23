import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { log } from '@main/lib/logger';
import {
  makeSshFingerprint,
  normalizeLocalPath,
  normalizePort,
  normalizeRemotePath,
} from '../normalize';
import {
  isUniqueConstraintError,
  readLegacyRows,
  toInteger,
  toIsoTimestamp,
  toTrimmedString,
} from './helpers';
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

function localProjectKey(projectPath: string): string {
  return `local:${normalizeLocalPath(projectPath)}`;
}

function sshProjectKey(fingerprint: string, projectPath: string): string {
  return `ssh:${fingerprint}:${normalizeRemotePath(projectPath)}`;
}

function pickDefaultProjectName(projectPath: string, fallbackId: string): string {
  const derived = basename(projectPath.trim());
  return derived.length > 0 ? derived : `Legacy Project ${fallbackId.slice(0, 8)}`;
}

function loadConnectionFingerprintById(appDb: PortContext['appDb']): Map<string, string> {
  const rows = appDb
    .prepare(`SELECT id, host, port, username FROM ssh_connections`)
    .all() as ConnectionFingerprintRow[];

  const result = new Map<string, string>();
  for (const row of rows) {
    result.set(row.id, makeSshFingerprint(row.host, normalizePort(row.port), row.username));
  }
  return result;
}

export function portProjects({ appDb, legacyDb, remap }: PortContext): PortSummary {
  const summary = createPortSummary('projects');
  const nowIso = new Date().toISOString();

  const existingProjectRows = appDb
    .prepare(
      `SELECT p.id, p.path, p.workspace_provider as workspaceProvider, p.ssh_connection_id as sshConnectionId, s.host, s.port, s.username
       FROM projects p
       LEFT JOIN ssh_connections s ON s.id = p.ssh_connection_id`
    )
    .all() as ExistingProjectRow[];

  const projectIds = new Set<string>();
  const localKeyToProjectId = new Map<string, string>();
  const sshKeyToProjectId = new Map<string, string>();

  for (const row of existingProjectRows) {
    projectIds.add(row.id);

    if (row.workspaceProvider === 'ssh' && row.sshConnectionId && row.host && row.username) {
      const fingerprint = makeSshFingerprint(row.host, normalizePort(row.port), row.username);
      sshKeyToProjectId.set(sshProjectKey(fingerprint, row.path), row.id);
      continue;
    }

    localKeyToProjectId.set(localProjectKey(row.path), row.id);
  }

  const connectionFingerprintById = loadConnectionFingerprintById(appDb);

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

  const insertStatement = appDb.prepare(`
    INSERT INTO projects (
      id,
      name,
      path,
      workspace_provider,
      base_ref,
      ssh_connection_id,
      created_at,
      updated_at
    )
    VALUES (
      @id,
      @name,
      @path,
      @workspaceProvider,
      @baseRef,
      @sshConnectionId,
      @createdAt,
      @updatedAt
    )
  `);

  for (const row of legacyRows) {
    summary.considered += 1;

    const legacyProjectId = toTrimmedString(row.id);
    if (!legacyProjectId) {
      summary.skippedInvalid += 1;
      log.warn('legacy-port: projects: skipping invalid row (missing id)');
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
      dedupKey = sshProjectKey(fingerprint, normalizedRemotePath);

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
      dedupKey = localProjectKey(localPath);

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

    let nextProjectId = projectIds.has(legacyProjectId) ? randomUUID() : legacyProjectId;

    const insertValues = {
      id: nextProjectId,
      name: toTrimmedString(row.name) ?? pickDefaultProjectName(projectPath, legacyProjectId),
      path: projectPath,
      workspaceProvider,
      baseRef: toTrimmedString(row.base_ref) ?? null,
      sshConnectionId: mappedSshConnectionId,
      createdAt,
      updatedAt,
    };

    let inserted = false;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        insertValues.id = nextProjectId;
        insertStatement.run(insertValues);
        inserted = true;
        break;
      } catch (error) {
        if (attempt === 0 && isUniqueConstraintError(error, 'projects.id')) {
          nextProjectId = randomUUID();
          continue;
        }

        if (isUniqueConstraintError(error, 'projects.path')) {
          const existingByPath = appDb
            .prepare(`SELECT id FROM projects WHERE path = ? LIMIT 1`)
            .get(projectPath) as { id: string } | undefined;

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
          break;
        }

        summary.skippedError += 1;
        log.warn('legacy-port: projects: failed to insert row', {
          legacyProjectId,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }

    if (!inserted) continue;

    remap.projectId.set(legacyProjectId, nextProjectId);
    projectIds.add(nextProjectId);
    summary.inserted += 1;

    if (workspaceProvider === 'ssh') {
      const fingerprint = mappedSshConnectionId
        ? connectionFingerprintById.get(mappedSshConnectionId)
        : undefined;
      if (fingerprint) {
        sshKeyToProjectId.set(sshProjectKey(fingerprint, projectPath), nextProjectId);
      }
    } else {
      localKeyToProjectId.set(localProjectKey(projectPath), nextProjectId);
    }
  }

  return summary;
}
