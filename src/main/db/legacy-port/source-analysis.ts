import type Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type {
  LegacyImportSource,
  LegacyPortPreview,
  LegacyProjectConflict,
  SourceProjectInfo,
} from '@shared/legacy-port';
import { projectRemotes, projects, sshConnections, tasks } from '@main/db/schema';
import {
  legacyTableExists,
  readLegacyRows,
  toInteger,
  toTrimmedString,
} from './importers/relational/helpers';
import type { RelationalImportDb } from './importers/relational/types';
import { makeSshFingerprint, normalizePort } from './legacy-source/normalize';
import {
  gitRemoteIdentityKeys,
  localProjectIdentityKey,
  sshProjectIdentityKey,
} from './legacy-source/project-identity';
import { quoteIdentifier } from './sqlite-utils';

export type LegacyProjectSelection = {
  skipLegacyProjectIds: Set<string>;
  replaceAppProjectIds: Set<string>;
  allowedLegacySshConnectionIds: Set<string>;
};

type AppProjectRow = {
  id: string;
  name: string;
  path: string;
  workspaceProvider: string;
  sshConnectionId: string | null;
  host: string | null;
  port: number | null;
  username: string | null;
  updatedAt: string;
};

type AppProjectRemoteRow = {
  projectId: string;
  remoteUrl: string;
};

async function readAppProjectRemoteRows(appDb: RelationalImportDb): Promise<AppProjectRemoteRow[]> {
  try {
    return (await appDb
      .select({
        projectId: projectRemotes.projectId,
        remoteUrl: projectRemotes.remoteUrl,
      })
      .from(projectRemotes)
      .execute()) as AppProjectRemoteRow[];
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such table: project_remotes')) {
      return [];
    }
    throw error;
  }
}

function countLegacyTasksByProject(legacyDb: Database.Database): Map<string, number> {
  const rows = readLegacyRows(legacyDb, 'tasks', ['project_id']);
  const result = new Map<string, number>();

  for (const row of rows) {
    const projectId = toTrimmedString(row.project_id);
    if (!projectId) continue;
    result.set(projectId, (result.get(projectId) ?? 0) + 1);
  }

  return result;
}

function countRows(legacyDb: Database.Database, tableName: string): number {
  if (!legacyTableExists(legacyDb, tableName)) return 0;
  const row = legacyDb
    .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`)
    .get() as { count: number };
  return row.count;
}

function legacySshFingerprintsById(legacyDb: Database.Database): Map<string, string> {
  const rows = readLegacyRows(legacyDb, 'ssh_connections', ['id', 'host', 'port', 'username']);
  const result = new Map<string, string>();

  for (const row of rows) {
    const id = toTrimmedString(row.id);
    const host = toTrimmedString(row.host);
    const username = toTrimmedString(row.username);
    if (!id || !host || !username) continue;
    result.set(id, makeSshFingerprint(host, normalizePort(toInteger(row.port)), username));
  }

  return result;
}

export function readLegacyProjectInfos(legacyDb: Database.Database): SourceProjectInfo[] {
  const taskCountByProject = countLegacyTasksByProject(legacyDb);
  const sshFingerprintById = legacySshFingerprintsById(legacyDb);
  const rows = readLegacyRows(legacyDb, 'projects', [
    'id',
    'name',
    'path',
    'git_remote',
    'github_repository',
    'is_remote',
    'remote_path',
    'ssh_connection_id',
    'updated_at',
  ]);

  const result: SourceProjectInfo[] = [];
  for (const row of rows) {
    const id = toTrimmedString(row.id);
    if (!id) continue;

    const isRemote = toInteger(row.is_remote) === 1;
    const name = toTrimmedString(row.name) ?? id;
    const updatedAt = toTrimmedString(row.updated_at) ?? null;
    const gitRemoteKeys = [
      toTrimmedString(row.git_remote),
      toTrimmedString(row.github_repository),
    ].flatMap((value) => {
      if (!value) return [];
      return gitRemoteIdentityKeys(value);
    });

    if (isRemote) {
      const sshConnectionId = toTrimmedString(row.ssh_connection_id);
      const remotePath = toTrimmedString(row.remote_path);
      if (!sshConnectionId || !remotePath) continue;

      const fingerprint = sshFingerprintById.get(sshConnectionId);
      if (!fingerprint) continue;

      result.push({
        id,
        identityKey: sshProjectIdentityKey(fingerprint, remotePath),
        kind: 'ssh',
        name,
        path: remotePath,
        taskCount: taskCountByProject.get(id) ?? 0,
        updatedAt,
        sshConnectionId,
        gitRemoteKeys,
      });
      continue;
    }

    const localPath = toTrimmedString(row.path);
    if (!localPath) continue;

    result.push({
      id,
      identityKey: localProjectIdentityKey(localPath),
      kind: 'local',
      name,
      path: localPath,
      taskCount: taskCountByProject.get(id) ?? 0,
      updatedAt,
      sshConnectionId: null,
      gitRemoteKeys,
    });
  }

  return result;
}

export async function readAppProjectInfos(appDb: RelationalImportDb): Promise<SourceProjectInfo[]> {
  const taskCounts = await appDb.select({ projectId: tasks.projectId }).from(tasks).execute();
  const taskCountByProject = new Map<string, number>();
  for (const task of taskCounts) {
    taskCountByProject.set(task.projectId, (taskCountByProject.get(task.projectId) ?? 0) + 1);
  }

  const remoteRows = await readAppProjectRemoteRows(appDb);
  const gitRemoteKeysByProject = new Map<string, string[]>();
  for (const row of remoteRows) {
    const keys = gitRemoteKeysByProject.get(row.projectId) ?? [];
    keys.push(...gitRemoteIdentityKeys(row.remoteUrl));
    gitRemoteKeysByProject.set(row.projectId, [...new Set(keys)]);
  }

  const rows = (await appDb
    .select({
      id: projects.id,
      name: projects.name,
      path: projects.path,
      workspaceProvider: projects.workspaceProvider,
      sshConnectionId: projects.sshConnectionId,
      host: sshConnections.host,
      port: sshConnections.port,
      username: sshConnections.username,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .leftJoin(sshConnections, eq(projects.sshConnectionId, sshConnections.id))
    .execute()) as AppProjectRow[];

  const result: SourceProjectInfo[] = [];
  for (const row of rows) {
    if (row.workspaceProvider === 'ssh' && row.sshConnectionId && row.host && row.username) {
      const fingerprint = makeSshFingerprint(row.host, normalizePort(row.port), row.username);
      result.push({
        id: row.id,
        identityKey: sshProjectIdentityKey(fingerprint, row.path),
        kind: 'ssh',
        name: row.name,
        path: row.path,
        taskCount: taskCountByProject.get(row.id) ?? 0,
        updatedAt: row.updatedAt,
        sshConnectionId: row.sshConnectionId,
        gitRemoteKeys: gitRemoteKeysByProject.get(row.id) ?? [],
      });
      continue;
    }

    result.push({
      id: row.id,
      identityKey: localProjectIdentityKey(row.path),
      kind: 'local',
      name: row.name,
      path: row.path,
      taskCount: taskCountByProject.get(row.id) ?? 0,
      updatedAt: row.updatedAt,
      sshConnectionId: null,
      gitRemoteKeys: gitRemoteKeysByProject.get(row.id) ?? [],
    });
  }

  return result;
}

export async function findLegacyProjectConflicts(
  appDb: RelationalImportDb,
  legacyDb: Database.Database
): Promise<LegacyProjectConflict[]> {
  const legacyProjects = readLegacyProjectInfos(legacyDb);
  const appProjects = await readAppProjectInfos(appDb);
  return findProjectConflicts(legacyProjects, appProjects);
}

function findProjectConflicts(
  legacyProjects: SourceProjectInfo[],
  appProjects: SourceProjectInfo[]
): LegacyProjectConflict[] {
  const appByIdentity = new Map(appProjects.map((project) => [project.identityKey, project]));
  const appByPath = new Map(appProjects.map((project) => [project.path, project]));
  const appLocalByGitRemote = new Map<string, SourceProjectInfo>();
  for (const project of appProjects) {
    if (project.kind !== 'local') continue;
    for (const key of project.gitRemoteKeys) {
      if (!appLocalByGitRemote.has(key)) appLocalByGitRemote.set(key, project);
    }
  }

  const conflicts: LegacyProjectConflict[] = [];
  for (const legacyProject of legacyProjects) {
    const appProjectByIdentity = appByIdentity.get(legacyProject.identityKey);
    const appProjectByPath = appByPath.get(legacyProject.path);
    const appProjectByGitRemote =
      legacyProject.kind === 'local'
        ? legacyProject.gitRemoteKeys
            .map((key) => ({ key, project: appLocalByGitRemote.get(key) }))
            .find((match): match is { key: string; project: SourceProjectInfo } =>
              Boolean(match.project)
            )
        : undefined;
    const appProject = appProjectByIdentity ?? appProjectByPath ?? appProjectByGitRemote?.project;
    if (!appProject) continue;
    conflicts.push({
      identityKey:
        appProjectByIdentity || appProjectByPath
          ? legacyProject.identityKey
          : (appProjectByGitRemote?.key ?? legacyProject.identityKey),
      kind: legacyProject.kind,
      v0: legacyProject,
      v1Beta: appProject,
    });
  }

  return conflicts;
}

export async function buildLegacyProjectSelection(args: {
  appDb: RelationalImportDb;
  legacyDb: Database.Database;
  selectedSources: ReadonlySet<LegacyImportSource>;
  conflictChoices: Record<string, LegacyImportSource>;
}): Promise<LegacyProjectSelection> {
  const legacyProjects = readLegacyProjectInfos(args.legacyDb);
  const legacyByIdentity = new Map(legacyProjects.map((project) => [project.identityKey, project]));
  const conflicts = await findLegacyProjectConflicts(args.appDb, args.legacyDb);
  const skipLegacyProjectIds = new Set<string>();
  const replaceAppProjectIds = new Set<string>();
  const allowedLegacySshConnectionIds = new Set<string>();

  if (args.selectedSources.has('v1-beta')) {
    for (const conflict of conflicts) {
      const choice = args.conflictChoices[conflict.identityKey] ?? 'v1-beta';
      if (choice === 'v0') {
        replaceAppProjectIds.add(conflict.v1Beta.id);
      } else {
        skipLegacyProjectIds.add(conflict.v0.id);
      }
    }
  }

  for (const legacyProject of legacyByIdentity.values()) {
    if (skipLegacyProjectIds.has(legacyProject.id)) continue;
    if (legacyProject.sshConnectionId) {
      allowedLegacySshConnectionIds.add(legacyProject.sshConnectionId);
    }
  }

  return {
    skipLegacyProjectIds,
    replaceAppProjectIds,
    allowedLegacySshConnectionIds,
  };
}

export async function createLegacyPortPreview(args: {
  appDb: RelationalImportDb;
  betaDb?: RelationalImportDb | null;
  legacyDb: Database.Database | null;
  hasLegacyDb: boolean;
  hasBetaDb: boolean;
}): Promise<LegacyPortPreview> {
  const betaProjects = args.hasBetaDb && args.betaDb ? await readAppProjectInfos(args.betaDb) : [];
  const betaTaskCount = betaProjects.reduce((total, project) => total + project.taskCount, 0);

  if (!args.legacyDb) {
    return {
      sources: {
        v0: { available: args.hasLegacyDb, projects: 0, tasks: 0 },
        v1Beta: { available: args.hasBetaDb, projects: betaProjects.length, tasks: betaTaskCount },
      },
      conflicts: [],
      projects: 0,
      tasks: 0,
    };
  }

  const legacyProjects = readLegacyProjectInfos(args.legacyDb);
  const legacyTaskCount = countRows(args.legacyDb, 'tasks');
  const conflicts =
    args.hasBetaDb && args.hasLegacyDb ? findProjectConflicts(legacyProjects, betaProjects) : [];

  return {
    sources: {
      v0: { available: args.hasLegacyDb, projects: legacyProjects.length, tasks: legacyTaskCount },
      v1Beta: { available: args.hasBetaDb, projects: betaProjects.length, tasks: betaTaskCount },
    },
    conflicts,
    projects: legacyProjects.length,
    tasks: legacyTaskCount,
  };
}
