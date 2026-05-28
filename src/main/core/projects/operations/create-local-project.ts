import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { GitService } from '@main/core/git/impl/git-service';
import { projectEvents } from '@main/core/projects/project-events';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import type { LocalProject, ProjectPathStatus } from '@shared/projects';
import { checkIsValidDirectory } from '../path-utils';
import { ensureGitRepository, resolveProjectBaseRef } from './create-project-utils';

export type CreateLocalProjectParams = {
  id?: string;
  path: string;
  name: string;
  initGitRepository?: boolean;
};

export async function createLocalProject(params: CreateLocalProjectParams): Promise<LocalProject> {
  const isValidDirectory = checkIsValidDirectory(params.path);
  if (!isValidDirectory) {
    throw new Error('Invalid directory');
  }

  const fs = new LocalFileSystem(params.path);
  const baseCtx = new LocalExecutionContext({ root: params.path });
  const git = new GitService(baseCtx, fs);
  const gitInfo = await ensureGitRepository(git, params.initGitRepository);
  const baseRef = await resolveProjectBaseRef(git, gitInfo.baseRef);

  const [row] = await db
    .insert(projects)
    .values({
      id: params.id ?? randomUUID(),
      name: params.name,
      path: gitInfo.rootPath,
      workspaceProvider: 'local',
      baseRef,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const project = {
    type: 'local' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? baseRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  await projectManager.openProject(project);
  projectEvents._emit('project:created', project);

  return project;
}

export async function getLocalProjectPathStatus(path: string): Promise<ProjectPathStatus> {
  const isDirectory = checkIsValidDirectory(path);
  if (!isDirectory) {
    return { isDirectory: false, isGitRepo: false };
  }

  const fs = new LocalFileSystem(path);
  const baseCtx = new LocalExecutionContext({ root: path });
  const git = new GitService(baseCtx, fs);
  const gitInfo = await git.detectInfo();
  return { isDirectory: true, isGitRepo: gitInfo.isGitRepo };
}
