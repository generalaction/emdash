import { randomUUID } from 'node:crypto';
import { err, ok } from '@emdash/shared';
import { sql } from 'drizzle-orm';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { statAbsolute } from '@main/core/runtime/files-helpers';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { log } from '@main/lib/logger';
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
  const runtimeLease = await runtimeManager.acquire({
    kind: 'ssh',
    connectionId: params.connectionId,
  });

  let gitInfo;
  try {
    const pathEntry = await statAbsolute(runtimeLease.value.files, params.path);
    if (!pathEntry.success || pathEntry.data.type !== 'directory') {
      return err({
        type: 'invalid-directory',
        path: params.path,
        message: 'Invalid directory',
      });
    }

    const repositoryResult = await ensureProjectRepository(
      runtimeLease.value.git,
      params.path,
      params.initGitRepository
    );
    if (!repositoryResult.success) return repositoryResult;
    gitInfo = repositoryResult.data;
  } finally {
    await runtimeLease.release();
  }

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
    const runtimeLease = await runtimeManager.acquire({ kind: 'ssh', connectionId });
    try {
      const pathEntry = await statAbsolute(runtimeLease.value.files, path);
      if (!pathEntry.success || pathEntry.data.type !== 'directory') {
        return { isDirectory: false, isGitRepo: false };
      }

      const inspection = await runtimeLease.value.git.inspectPath(path);
      if (inspection.kind === 'inspect-failed') {
        return {
          isDirectory: true,
          isGitRepo: false,
          error: { type: 'inspect-failed', path: inspection.path, message: inspection.message },
        };
      }
      return { isDirectory: true, isGitRepo: inspection.kind === 'repository' };
    } finally {
      await runtimeLease.release();
    }
  } catch {
    return { isDirectory: false, isGitRepo: false };
  }
}
