import { randomUUID } from 'node:crypto';
import nodePath from 'node:path';
import { err, ok } from '@emdash/shared';
import { sql } from 'drizzle-orm';
import { RuntimeFileSystem } from '@main/core/files/runtime-files';
import { fsErrorMessage } from '@main/core/files/scoped-file-system';
import { RuntimeGit } from '@main/core/git/runtime-git';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { CreateProjectResult, ProjectPathStatus } from '@shared/projects';
import { getDirectoryStatus } from '../path-utils';
import { ensureProjectRepository } from './create-project-utils';
import { ensureRepositoryWorkspace } from './ensure-repository-workspace';

const git = new RuntimeGit();

export type CreateLocalProjectParams = {
  id?: string;
  path: string;
  name: string;
  initGitRepository?: boolean;
};

export async function createLocalProject(
  params: CreateLocalProjectParams
): Promise<CreateProjectResult> {
  const directoryStatus = getDirectoryStatus(params.path);
  if (directoryStatus.kind === 'inspect-failed') {
    return err({
      type: 'inspect-failed',
      path: params.path,
      message: directoryStatus.message,
    });
  }
  if (directoryStatus.kind !== 'directory') {
    return err({
      type: 'invalid-directory',
      path: params.path,
      message: 'Invalid directory',
    });
  }

  const repositoryResult = await ensureProjectRepository(
    git,
    params.path,
    params.initGitRepository
  );
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
  try {
    const pathEntry = await new RuntimeFileSystem(nodePath.dirname(path)).stat(path);
    if (!pathEntry.success) {
      if (pathEntry.error.type === 'not-found') {
        return { isDirectory: false, isGitRepo: false };
      }
      return {
        isDirectory: false,
        isGitRepo: false,
        error: { type: 'inspect-failed', path, message: fsErrorMessage(pathEntry.error) },
      };
    }
    if (pathEntry.data.type !== 'directory') {
      return { isDirectory: false, isGitRepo: false };
    }

    const inspection = await git.inspectPath(path);
    if (inspection.kind === 'inspect-failed') {
      return {
        isDirectory: true,
        isGitRepo: false,
        error: { type: 'inspect-failed', path: inspection.path, message: inspection.message },
      };
    }
    return { isDirectory: true, isGitRepo: inspection.kind === 'repository' };
  } catch (error) {
    return {
      isDirectory: false,
      isGitRepo: false,
      error: { type: 'inspect-failed', path, message: String(error) },
    };
  }
}
