import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { err, ok } from '@shared/lib/result';
import type { CreateProjectResult, ProjectPathStatus } from '@shared/projects';
import { checkIsValidDirectory } from '../path-utils';
import { ensureProjectRepository } from './create-project-utils';
import { ensureRepositoryWorkspace } from './ensure-repository-workspace';

export type CreateLocalProjectParams = {
  id?: string;
  path: string;
  name: string;
  initGitRepository?: boolean;
};

export async function createLocalProject(
  params: CreateLocalProjectParams
): Promise<CreateProjectResult> {
  const isValidDirectory = checkIsValidDirectory(params.path);
  if (!isValidDirectory) {
    return err({
      type: 'invalid-directory',
      path: params.path,
      message: 'Invalid directory',
    });
  }

  const runtimeLease = await runtimeManager.acquire({ kind: 'local' });
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
    repositoryWorkspaceId: null as string | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  await projectManager.openProject(project);

  try {
    project.repositoryWorkspaceId = ensureRepositoryWorkspace(project);
  } catch (error) {
    log.warn('createLocalProject: ensureRepositoryWorkspace failed (non-fatal)', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  projectEvents._emit('project:created', project);

  return ok(project);
}

export async function getLocalProjectPathStatus(path: string): Promise<ProjectPathStatus> {
  const isDirectory = checkIsValidDirectory(path);
  if (!isDirectory) {
    return { isDirectory: false, isGitRepo: false };
  }

  const runtimeLease = await runtimeManager.acquire({ kind: 'local' });
  try {
    const inspection = await runtimeLease.value.git.inspectPath(path);
    return { isDirectory: true, isGitRepo: inspection.kind === 'repository' };
  } finally {
    runtimeLease.release();
  }
}
