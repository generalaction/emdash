import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { type LocalProject, type ProjectPathStatus, type SshProject } from '@shared/projects';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { checkIsValidDirectory } from '@main/core/git/impl/detectGitInfo';
import { GitService } from '@main/core/git/impl/git-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { projectManager } from '@main/core/projects/project-manager';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { getGitSshExec, getLocalExec } from '@main/core/utils/exec';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';

async function ensureGitRepository(
  git: GitService,
  initGitRepository?: boolean
): ReturnType<GitService['detectInfo']> {
  let gitInfo = await git.detectInfo();
  if (!gitInfo.isGitRepo) {
    if (!initGitRepository) {
      throw new Error(
        'Directory is not a git repository. Enable "Initialize git repository" to continue.'
      );
    }
    await git.initRepository();
    gitInfo = await git.detectInfo();
  }
  if (!gitInfo.isGitRepo) {
    throw new Error('Failed to initialize git repository');
  }
  return gitInfo;
}

export type CreateLocalProjectParams = {
  id?: string;
  path: string;
  name: string;
  initGitRepository?: boolean;
};

export async function createLocalProject(params: CreateLocalProjectParams): Promise<LocalProject> {
  const isValidDirectory = checkIsValidDirectory(params.path);
  if (!isValidDirectory) {
    throw new Error('Invalid directory');
  }

  const fs = new LocalFileSystem(params.path);
  const git = new GitService(params.path, getLocalExec(), fs);
  const gitInfo = await ensureGitRepository(git, params.initGitRepository);

  const [row] = await db
    .insert(projects)
    .values({
      id: params.id ?? randomUUID(),
      name: params.name,
      path: gitInfo.rootPath,
      workspaceProvider: 'local',
      baseRef: gitInfo.baseRef,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const project = {
    type: 'local' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? gitInfo.baseRef,
    iconDataUrl: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  await projectManager.openProject(project);

  return project;
}

export async function getLocalProjectPathStatus(path: string): Promise<ProjectPathStatus> {
  const isDirectory = checkIsValidDirectory(path);
  if (!isDirectory) {
    return { isDirectory: false, isGitRepo: false };
  }

  const fs = new LocalFileSystem(path);
  const git = new GitService(path, getLocalExec(), fs);
  const gitInfo = await git.detectInfo();
  return { isDirectory: true, isGitRepo: gitInfo.isGitRepo };
}

export type CreateSshProjectParams = {
  id?: string;
  name: string;
  path: string;
  connectionId: string;
  initGitRepository?: boolean;
};

export async function createSshProject(params: CreateSshProjectParams): Promise<SshProject> {
  const sshProxy = await sshConnectionManager.connect(params.connectionId);

  const sshFs = new SshFileSystem(sshProxy, params.path);
  const pathEntry = await sshFs.stat('');
  if (!pathEntry || pathEntry.type !== 'dir') {
    throw new Error('Invalid directory');
  }
  const git = new GitService(
    params.path,
    getGitSshExec(sshProxy, () => githubConnectionService.getToken()),
    sshFs,
    false
  );

  const gitInfo = await ensureGitRepository(git, params.initGitRepository);

  const [row] = await db
    .insert(projects)
    .values({
      id: params.id ?? randomUUID(),
      name: params.name,
      path: gitInfo.rootPath,
      workspaceProvider: 'ssh',
      sshConnectionId: params.connectionId,
      baseRef: gitInfo.baseRef,
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
    iconDataUrl: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  await projectManager.openProject(project);

  return project;
}

export async function getSshProjectPathStatus(
  path: string,
  connectionId: string
): Promise<ProjectPathStatus> {
  try {
    const sshProxy = await sshConnectionManager.connect(connectionId);
    const sshFs = new SshFileSystem(sshProxy, path);
    const pathEntry = await sshFs.stat('');
    if (!pathEntry || pathEntry.type !== 'dir') {
      return { isDirectory: false, isGitRepo: false };
    }

    const git = new GitService(
      path,
      getGitSshExec(sshProxy, () => githubConnectionService.getToken()),
      sshFs,
      false
    );
    const gitInfo = await git.detectInfo();
    return { isDirectory: true, isGitRepo: gitInfo.isGitRepo };
  } catch {
    return { isDirectory: false, isGitRepo: false };
  }
}
