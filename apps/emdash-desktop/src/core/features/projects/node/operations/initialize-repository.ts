import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { projectHostRef } from '@core/primitives/projects/api';
import type { InitializeRepositoryResult } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects } from '@core/services/app-db/node/schema';
import { ensureProjectRepository } from './create-project-utils';
import { ensureRepositoryWorkspace } from './ensure-repository-workspace';
import { projectFromRow } from './getProjects';

export type InitializeRepositoryDependencies = {
  db: AppDb;
  runtimes: Pick<RuntimeBroker, 'client'>;
  projects: Pick<ProjectSessionManager, 'openProject'>;
};

export async function initializeRepository(
  dependencies: InitializeRepositoryDependencies,
  projectId: string
): Promise<InitializeRepositoryResult> {
  const [existingRow] = await dependencies.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);

  if (!existingRow) {
    return err({
      type: 'project-not-found',
      projectId,
      message: `Project ${projectId} not found`,
    });
  }

  const existingProject = projectFromRow(existingRow);
  const host = projectHostRef(existingProject);
  const runtime = await dependencies.runtimes.client(host);
  if (!runtime.success) return err(runtime.error);

  const repositoryResult = await ensureProjectRepository(
    runtime.data.git,
    existingProject.path,
    true
  );
  if (!repositoryResult.success) return repositoryResult;

  const [row] = await dependencies.db
    .update(projects)
    .set({
      path: repositoryResult.data.rootPath,
      baseRef: repositoryResult.data.baseRef,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .returning();

  const project = projectFromRow(row);
  await dependencies.projects.openProject(project);

  try {
    project.repositoryWorkspaceId = ensureRepositoryWorkspace(dependencies.db, project);
  } catch (error) {
    log.warn('initializeRepository: ensureRepositoryWorkspace failed (non-fatal)', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return ok(project);
}
