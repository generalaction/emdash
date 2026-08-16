import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import { projectHostRef } from '@core/primitives/projects/api';
import type { InitializeRepositoryResult } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects } from '@core/services/app-db/node/schema';
import { ensureProjectRepository } from './create-project-utils';
import { getProjectById } from './getProjects';

export type InitializeRepositoryDependencies = {
  db: AppDb;
  runtimes: Pick<RuntimeBroker, 'client'>;
  projects: Pick<ProjectAttachmentManager, 'invalidate'>;
};

export async function initializeRepository(
  dependencies: InitializeRepositoryDependencies,
  projectId: string
): Promise<InitializeRepositoryResult> {
  const existingProject = await getProjectById(dependencies.db, projectId);
  if (!existingProject) {
    return err({
      type: 'project-not-found',
      projectId,
      message: `Project ${projectId} not found`,
    });
  }

  const host = projectHostRef(existingProject);
  const runtime = await dependencies.runtimes.client(host);
  if (!runtime.success) return err(runtime.error);

  const repositoryResult = await ensureProjectRepository(
    runtime.data.git,
    existingProject.path,
    true
  );
  if (!repositoryResult.success) return repositoryResult;

  await dependencies.db
    .update(projects)
    .set({
      baseRef: repositoryResult.data.baseRef,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)));

  // The repository workspace row owns the project path; git init may have
  // resolved it to the actual repository root.
  if (existingProject.repositoryWorkspaceId) {
    createWorkspaceRegistry(dependencies.db).annotate(existingProject.repositoryWorkspaceId, {
      path: repositoryResult.data.rootPath,
    });
  }

  const project = await getProjectById(dependencies.db, projectId);
  if (!project) {
    return err({
      type: 'project-not-found',
      projectId,
      message: `Project ${projectId} not found after initializing its repository`,
    });
  }
  await dependencies.projects
    .invalidate(projectId, 'repository-changed')
    .catch((error: unknown) => {
      log.warn('initializeRepository: failed to invalidate the previous attachment', {
        projectId,
        error: String(error),
      });
    });

  appDbPokes.projects.poke({ projectId });
  return ok(project);
}
