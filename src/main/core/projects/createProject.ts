import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { type LocalProject, type SshProject } from '@shared/projects/types';
import { db } from '@main/db/client';
import { projects, sshConnections } from '@main/db/schema';
import { LocalGitService } from '../git/git-provider/local-git-provider';
import { SshGitService } from '../git/git-provider/ssh-git-provider';
import { sshConnectionManager } from '../ssh/ssh-connection-manager';
import { buildConnectConfigFromRow } from '../workspaces/build-connect-config';
import { checkIsValidDirectory } from './detectGitInfo';

export type CreateLocalProjectParams = {
  id?: string;
  path: string;
  name: string;
};

export async function createLocalProject(params: CreateLocalProjectParams): Promise<LocalProject> {
  const isValidDirectory = checkIsValidDirectory(params.path);
  if (!isValidDirectory) {
    throw new Error('Invalid directory');
  }

  const git = new LocalGitService(params.path);

  const gitInfo = await git.detectInfo();
  if (!gitInfo.isGitRepo) {
    throw new Error('Invalid git repository');
  }

  const [row] = await db
    .insert(projects)
    .values({
      id: params.id ?? randomUUID(),
      name: params.name,
      path: gitInfo.rootPath,
      workspaceProvider: 'local',
      baseRef: gitInfo.baseRef,
      gitRemote: gitInfo.remote ?? null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  return {
    type: 'local' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? gitInfo.baseRef,
    gitRemote: row.gitRemote ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type CreateSshProjectParams = {
  id?: string;
  name: string;
  path: string;
  connectionId: string;
};

export async function createSshProject(params: CreateSshProjectParams): Promise<SshProject> {
  const [sshConnectionRow] = await db
    .select()
    .from(sshConnections)
    .where(eq(sshConnections.id, params.connectionId))
    .limit(1);

  const connConfig = await buildConnectConfigFromRow(sshConnectionRow);

  const sshProxy = await sshConnectionManager.connect(params.connectionId, connConfig);

  if (!sshProxy.success) {
    throw new Error(sshProxy.error.message);
  }

  const git = new SshGitService(sshProxy.data, params.path);

  const gitInfo = await git.detectInfo();

  const [row] = await db
    .insert(projects)
    .values({
      id: params.id ?? randomUUID(),
      name: params.name,
      path: params.path,
      workspaceProvider: 'ssh',
      sshConnectionId: params.connectionId,
      baseRef: gitInfo.baseRef,
      gitRemote: gitInfo.remote ?? null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  return {
    type: 'ssh' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    connectionId: params.connectionId,
    baseRef: row.baseRef ?? gitInfo.baseRef,
    gitRemote: row.gitRemote ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
