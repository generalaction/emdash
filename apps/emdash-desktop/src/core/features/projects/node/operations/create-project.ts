import { randomUUID } from 'node:crypto';
import type { HostRef } from '@emdash/core/primitives/host/api';
import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import { eq, sql } from 'drizzle-orm';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import { projectEvents } from '@core/features/projects/api/node/project-events';
import { fileKeyForAbsolutePath, hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import type { CreateProjectResult } from '@core/primitives/projects/api';
import type {
  CreateProjectParams,
  InspectProjectPathParams,
  ProjectPathInspection,
} from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects } from '@core/services/app-db/node/schema';
import { fsErrorMessage } from '@core/services/runtime-broker/node/files';
import { ensureProjectRepository } from './create-project-utils';
import { projectFromRow } from './getProjects';
import { getProjectByPath } from './getProjects';
import { getProjectPathStatus } from './project-path-status';
import { registerRepositoryWorkspace } from './register-repository-workspace';

export type CreateProjectOnHostParams = {
  id?: string;
  path: string;
  name: string;
  initGitRepository?: boolean;
};

export type CreateProjectDependencies = {
  db: AppDb;
  runtimes: Pick<RuntimeBroker, 'client'>;
  projects: Pick<ProjectAttachmentManager, 'openProject'>;
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
  if (
    !repositoryResult.success &&
    (repositoryResult.error.type !== 'not-repository' || params.initGitRepository)
  ) {
    return repositoryResult;
  }

  const gitInfo = repositoryResult.success
    ? repositoryResult.data
    : {
        rootPath: params.path,
        baseRef: null,
      };

  const [row] = await dependencies.db
    .insert(projects)
    .values({
      id: params.id ?? randomUUID(),
      name: params.name,
      baseRef: gitInfo.baseRef,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  // The repository workspace row owns the project's path and host identity,
  // so registration is part of creation — a project without one is unusable.
  // On failure (e.g. the path's repository row is already linked to another
  // project), remove the just-inserted project row instead of orphaning it.
  let repositoryWorkspaceId: string;
  try {
    repositoryWorkspaceId = registerRepositoryWorkspace(dependencies.db, {
      id: row.id,
      path: gitInfo.rootPath,
      host,
    });
  } catch (error) {
    await dependencies.db.delete(projects).where(eq(projects.id, row.id));
    return err({
      type: 'invalid-directory',
      path: gitInfo.rootPath,
      message:
        error instanceof Error && error.message.includes('idx_projects_repository_workspace_id')
          ? 'A project already exists at this path'
          : `Could not register the project repository: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const project = projectFromRow(row, {
    path: gitInfo.rootPath,
    location: host.type === 'remote' ? 'remote' : 'local',
    sshConnectionId: host.type === 'remote' ? host.id : null,
  });
  if (!project) {
    return err({
      type: 'invalid-directory',
      path: gitInfo.rootPath,
      message: 'Project repository path could not be resolved',
    });
  }
  project.repositoryWorkspaceId = repositoryWorkspaceId;

  await dependencies.projects.openProject(project);

  projectEvents._emit('project:created', project);
  appDbPokes.projects.poke({ projectId: project.id });

  return ok(project);
}
