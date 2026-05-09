import { eq } from 'drizzle-orm';
import { remoteNameFromQualifiedRef, resolveBaseRefFromRemoteDefault } from '@shared/git-utils';
import type { LocalProject } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import { GitHubAuthExecutionContext } from '@main/core/execution-context/github-auth-execution-context';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { GitService } from '@main/core/git/impl/git-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { projects } from '@main/db/schema';
import { checkIsValidDirectory } from '../path-utils';
import { getProjectById } from './getProjects';

export type RelocateProjectError =
  | { type: 'not-found'; message: string }
  | { type: 'unsupported'; message: string }
  | { type: 'invalid-directory'; message: string }
  | { type: 'not-a-git-repo'; message: string }
  | { type: 'path-conflict'; message: string; existingProjectId: string }
  | { type: 'error'; message: string };

async function resolveBaseRef(git: GitService, detectedBaseRef: string): Promise<string> {
  const remoteName = remoteNameFromQualifiedRef(detectedBaseRef);
  if (!remoteName) return detectedBaseRef;
  try {
    const [gitDefaultBranch, branches] = await Promise.all([
      git.getDefaultBranch(remoteName),
      git.getBranches(),
    ]);
    return resolveBaseRefFromRemoteDefault({ detectedBaseRef, gitDefaultBranch, branches });
  } catch {
    return detectedBaseRef;
  }
}

export async function relocateLocalProject(
  projectId: string,
  newPath: string
): Promise<Result<LocalProject, RelocateProjectError>> {
  const project = await getProjectById(projectId);
  if (!project) {
    return err({ type: 'not-found', message: `Project not found: ${projectId}` });
  }
  if (project.type !== 'local') {
    return err({ type: 'unsupported', message: 'Only local projects can be relocated' });
  }

  if (!checkIsValidDirectory(newPath)) {
    return err({ type: 'invalid-directory', message: `Not a directory: ${newPath}` });
  }

  const fs = new LocalFileSystem(newPath);
  const baseCtx = new LocalExecutionContext({ root: newPath });
  const authCtx = new GitHubAuthExecutionContext(baseCtx, () => githubConnectionService.getToken());
  const git = new GitService(baseCtx, authCtx, fs);

  let gitInfo: Awaited<ReturnType<GitService['detectInfo']>>;
  try {
    gitInfo = await git.detectInfo();
  } catch (e) {
    return err({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
  if (!gitInfo.isGitRepo) {
    return err({ type: 'not-a-git-repo', message: 'Selected directory is not a git repository' });
  }

  const resolvedPath = gitInfo.rootPath;

  const [collision] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.path, resolvedPath))
    .limit(1);
  if (collision && collision.id !== projectId) {
    return err({
      type: 'path-conflict',
      message: 'Another project is already registered at this path',
      existingProjectId: collision.id,
    });
  }

  const baseRef = await resolveBaseRef(git, gitInfo.baseRef);

  await projectManager.closeProject(projectId);

  const [row] = await db
    .update(projects)
    .set({
      path: resolvedPath,
      baseRef,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(projects.id, projectId))
    .returning();

  return ok({
    type: 'local' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? baseRef,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
