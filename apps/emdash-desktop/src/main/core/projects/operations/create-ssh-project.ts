import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { err, ok } from '@shared/lib/result';
import type { CreateProjectResult, ProjectPathStatus } from '@shared/projects';
import { ensureProjectRepository } from './create-project-utils';
import { ensureRepositoryWorkspace } from './ensure-repository-workspace';

export type CreateSshProjectParams = {
  id?: string;
  name: string;
  path: string;
  connectionId: string;
  initGitRepository?: boolean;
};

export async function createSshProject(
  params: CreateSshProjectParams
): Promise<CreateProjectResult> {
  const sshProxy = await sshConnectionManager.connect(params.connectionId);

  const sshFs = new SshFileSystem(sshProxy, params.path);
  const pathEntry = await sshFs.stat('');
  if (!pathEntry || pathEntry.type !== 'dir') {
    return err({
      type: 'invalid-directory',
      path: params.path,
      message: 'Invalid directory',
    });
  }
  const runtimeLease = await runtimeManager.acquire({
    kind: 'ssh',
    connectionId: params.connectionId,
  });
  const repositoryResult = await ensureProjectRepository(
    runtimeLease.value.git,
    params.path,
    params.initGitRepository
  ).finally(() => runtimeLease.release());
  if (!repositoryResult.success) return repositoryResult;
  const gitInfo = repositoryResult.data;

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
    repositoryWorkspaceId: null as string | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  await projectManager.openProject(project);

  try {
    project.repositoryWorkspaceId = ensureRepositoryWorkspace(project);
  } catch (error) {
    log.warn('createSshProject: ensureRepositoryWorkspace failed (non-fatal)', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  projectEvents._emit('project:created', project);

  return ok(project);
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

    const runtimeLease = await runtimeManager.acquire({ kind: 'ssh', connectionId });
    try {
      const inspection = await runtimeLease.value.git.inspectPath(path);
      return { isDirectory: true, isGitRepo: inspection.kind === 'repository' };
    } finally {
      runtimeLease.release();
    }
  } catch {
    return { isDirectory: false, isGitRepo: false };
  }
}
