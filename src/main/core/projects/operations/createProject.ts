import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { type LocalProject, type SshProject } from '@shared/projects';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { checkIsValidDirectory } from '@main/core/git/impl/detectGitInfo';
import { GitService } from '@main/core/git/impl/git-service';
import { githubAuthService } from '@main/core/github/services/github-auth-service';
import { projectManager } from '@main/core/projects/project-manager';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { getGitSshExec, getLocalExec } from '@main/core/utils/exec';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

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

  const fs = new LocalFileSystem(params.path);
  const git = new GitService(params.path, getLocalExec(), fs);

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

  await projectManager.openProject(project);

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

  const sshFs = new SshFileSystem(sshProxy, params.path);
  const git = new GitService(
    params.path,
    getGitSshExec(sshProxy, () => githubAuthService.getToken()),
    sshFs
  );

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

  await projectManager.openProject(project);

  return project;
}
