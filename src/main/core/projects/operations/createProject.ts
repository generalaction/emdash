import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { type LocalProject, type SshProject } from '@shared/projects/types';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { checkIsValidDirectory } from '../../git/impl/detectGitInfo';
import { LocalGitService } from '../../git/impl/local-git-provider';
import { SshGitService } from '../../git/impl/ssh-git-provider';
import { sshConnectionManager } from '../../ssh/ssh-connection-manager';

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

  const project = {
    type: 'local' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? gitInfo.baseRef,
    gitRemote: row.gitRemote ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  await projectManager.addProject(project);

  return project;
}

export type CreateSshProjectParams = {
  id?: string;
  name: string;
  path: string;
  connectionId: string;
};

export async function createSshProject(params: CreateSshProjectParams): Promise<SshProject> {
  const sshProxy = await sshConnectionManager.connect(params.connectionId);

  const git = new SshGitService(sshProxy, params.path);

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

  const project = {
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

  await projectManager.addProject(project);

  return project;
}
