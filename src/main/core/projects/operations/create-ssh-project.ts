import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { GitHubAuthExecutionContext } from '@main/core/execution-context/github-auth-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { GitService } from '@main/core/git/impl/git-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import type { ProjectPathStatus, SshProject } from '@shared/projects';
import { ensureGitRepository, resolveProjectBaseRef } from './create-project-utils';

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
  const baseSshCtx = new SshExecutionContext(sshProxy, { root: params.path });
  const authSshCtx = new GitHubAuthExecutionContext(baseSshCtx, () =>
    githubConnectionService.getToken()
  );
  const git = new GitService(baseSshCtx, authSshCtx, sshFs);

  const gitInfo = await ensureGitRepository(git, params.initGitRepository);
  const baseRef = await resolveProjectBaseRef(git, gitInfo.baseRef);

  const [row] = await db
    .insert(projects)
    .values({
      id: params.id ?? randomUUID(),
      name: params.name,
      path: gitInfo.rootPath,
      workspaceProvider: 'ssh',
      sshConnectionId: params.connectionId,
      baseRef,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const project = {
    type: 'ssh' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    connectionId: params.connectionId,
    baseRef: row.baseRef ?? baseRef,
    archived: row.archived,
    icon: row.icon,
    iconColor: row.iconColor,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  await projectManager.openProject(project);
  projectEvents._emit('project:created', project);

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

    const baseSshCtx = new SshExecutionContext(sshProxy, { root: path });
    const authSshCtx = new GitHubAuthExecutionContext(baseSshCtx, () =>
      githubConnectionService.getToken()
    );
    const git = new GitService(baseSshCtx, authSshCtx, sshFs);
    const gitInfo = await git.detectInfo();
    return { isDirectory: true, isGitRepo: gitInfo.isGitRepo };
  } catch {
    return { isDirectory: false, isGitRepo: false };
  }
}
