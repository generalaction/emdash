import { randomUUID } from 'node:crypto';
import nodePath from 'node:path';
import { err, ok } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { sql } from 'drizzle-orm';
import { projectEvents } from '@core/features/projects/api/node/project-events';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { hostPathFromNative, nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type { CreateProjectResult, ProjectPathStatus } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects } from '@core/services/app-db/node/schema';
import type {
  FilesRuntimeClient,
  GitRuntimeClient,
} from '@core/services/runtime-broker/api/clients';
import {
  fileKey,
  filesClientScope,
  fsErrorMessage,
} from '@core/services/runtime-broker/node/files';
import { getDirectoryStatus } from '../path-utils';
import { ensureProjectRepository } from './create-project-utils';
import { ensureRepositoryWorkspace } from './ensure-repository-workspace';

export type CreateLocalProjectParams = {
  id?: string;
  path: string;
  name: string;
  initGitRepository?: boolean;
};

export type LocalProjectOperationDependencies = {
  db: AppDb;
  getFilesRuntimeClient(): Promise<FilesRuntimeClient>;
  getGitRuntimeClient(): Promise<GitRuntimeClient>;
  projects: Pick<ProjectSessionManager, 'openProject'>;
};

export async function createLocalProject(
  dependencies: LocalProjectOperationDependencies,
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
    await dependencies.getGitRuntimeClient(),
    params.path,
    params.initGitRepository
  );
  if (!repositoryResult.success) return repositoryResult;
  const gitInfo = repositoryResult.data;

  const [row] = await dependencies.db
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

  await dependencies.projects.openProject(project);

  try {
    project.repositoryWorkspaceId = ensureRepositoryWorkspace(dependencies.db, project);
  } catch (error) {
    log.warn('createLocalProject: ensureRepositoryWorkspace failed (non-fatal)', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  projectEvents._emit('project:created', project);

  return ok(project);
}

export async function getLocalProjectPathStatus(
  dependencies: Pick<
    LocalProjectOperationDependencies,
    'getFilesRuntimeClient' | 'getGitRuntimeClient'
  >,
  path: string
): Promise<ProjectPathStatus> {
  try {
    const filesClient = await dependencies.getFilesRuntimeClient();
    const files = filesClientScope(filesClient, nodePath.dirname(path));
    const pathEntry = await filesClient.fs.stat(fileKey(files, path));
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

    const inspection = await (
      await dependencies.getGitRuntimeClient()
    ).inspectPath({
      path: hostPathFromNative(path),
    });
    if (inspection.kind === 'inspect-failed') {
      return {
        isDirectory: true,
        isGitRepo: false,
        error: {
          type: 'inspect-failed',
          path: nativePathFromHost(inspection.path),
          message: inspection.message,
        },
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
