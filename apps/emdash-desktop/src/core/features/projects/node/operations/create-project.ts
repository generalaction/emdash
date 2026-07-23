import { randomUUID } from 'node:crypto';
import type { HostRef } from '@emdash/core/primitives/host/api';
import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { sql } from 'drizzle-orm';
import { projectEvents } from '@core/features/projects/api/node/project-events';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import type { CreateProjectResult } from '@core/primitives/projects/api';
import type {
  CreateProjectParams,
  InspectProjectPathParams,
  ProjectPathInspection,
} from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects } from '@core/services/app-db/node/schema';
import { fsErrorMessage } from '@core/services/runtime-broker/node/files';
import { ensureProjectRepository } from './create-project-utils';
import { ensureRepositoryWorkspace } from './ensure-repository-workspace';
import { projectFromRow } from './getProjects';
import { getProjectByPath } from './getProjects';
import { fileKeyForAbsolutePath } from './project-path-status';
import { getProjectPathStatus } from './project-path-status';

export type CreateProjectOnHostParams = {
  id?: string;
  path: string;
  name: string;
  initGitRepository?: boolean;
};

export type CreateProjectDependencies = {
  db: AppDb;
  runtimes: Pick<RuntimeBroker, 'client'>;
  projects: Pick<ProjectSessionManager, 'openProject'>;
};

export async function createProject(
  dependencies: CreateProjectDependencies,
  params: CreateProjectParams
): Promise<CreateProjectResult> {
  const host = params.type === 'ssh' ? hostRef('remote', params.connectionId) : LOCAL_HOST_REF;
  return createProjectOnHost(dependencies, host, {
    id: params.id,
    name: params.name,
    path: params.path,
    initGitRepository: params.initGitRepository,
  });
}

export async function inspectProjectPath(
  dependencies: CreateProjectDependencies,
  params: InspectProjectPathParams
): Promise<ProjectPathInspection> {
  const host = params.type === 'ssh' ? hostRef('remote', params.connectionId) : LOCAL_HOST_REF;
  const [status, existingProject] = await Promise.all([
    getProjectPathStatus(dependencies, host, params.path),
    getProjectByPath(dependencies.db, host, params.path),
  ]);
  return { ...status, existingProject };
}

async function createProjectOnHost(
  dependencies: CreateProjectDependencies,
  host: HostRef,
  params: CreateProjectOnHostParams
): Promise<CreateProjectResult> {
  const runtime = await dependencies.runtimes.client(host);
  if (!runtime.success) return err(runtime.error);

  const pathEntry = await runtime.data.files.fs.stat(
    fileKeyForAbsolutePath(hostPathFromNative(params.path))
  );
  if (!pathEntry.success && pathEntry.error.type !== 'not-found') {
    return err({
      type: 'inspect-failed',
      path: params.path,
      message: fsErrorMessage(pathEntry.error),
    });
  }
  if (!pathEntry.success || pathEntry.data.type !== 'directory') {
    return err({
      type: 'invalid-directory',
      path: params.path,
      message: 'Invalid directory',
    });
  }

  const repositoryResult = await ensureProjectRepository(
    runtime.data.git,
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
      workspaceProvider: host.type === 'remote' ? 'ssh' : 'local',
      sshConnectionId: host.type === 'remote' ? host.id : null,
      baseRef: gitInfo.baseRef,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const project = projectFromRow(row);

  await dependencies.projects.openProject(project);

  try {
    project.repositoryWorkspaceId = ensureRepositoryWorkspace(dependencies.db, project);
  } catch (error) {
    log.warn('createProjectOnHost: ensureRepositoryWorkspace failed (non-fatal)', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  projectEvents._emit('project:created', project);

  return ok(project);
}
