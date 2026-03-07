import { db } from '../../db/client';
import { projects } from '../../db/schema';
import { githubService } from '../../../_deprecated/services/GitHubService';
import { randomUUID } from 'node:crypto';
import { checkIsGithubRemote, checkIsValidDirectory, detectGitInfo } from './detectGitInfo';
import { err, ok, Result } from '../../../_deprecated/lib/result';
import { sql } from 'drizzle-orm';
import { type LocalProject } from './types';
import { ensureProjectSettings } from './ensureProjectSettings';

export type CreateLocalProjectParams = {
  type: 'local';
  path: string;
  name: string;
};

type CreateProjectError =
  | {
      type: 'invalid_directory';
    }
  | {
      type: 'invalid_git_repository';
    }
  | {
      type: 'invalid_project_type';
    };

export async function handleCreateLocalProject(
  params: CreateLocalProjectParams
): Promise<Result<LocalProject, CreateProjectError>> {
  const isValidDirectory = checkIsValidDirectory(params.path);
  if (!isValidDirectory) {
    return err({ type: 'invalid_directory' });
  }

  const gitInfo = await detectGitInfo(params.path);
  if (!gitInfo.isGitRepo) {
    return err({ type: 'invalid_git_repository' });
  }

  let githubRepository: string | undefined;
  let githubConnected: boolean = false;

  const isGithubRemote = checkIsGithubRemote(gitInfo.remote);
  if (isGithubRemote && (await githubService.isAuthenticated())) {
    try {
      const repoInfo = await githubService.getLocalRepoInfo(params.path);
      if (repoInfo) {
        githubRepository = repoInfo.nameWithOwner;
        githubConnected = true;
      }
    } catch (e) {}
  }

  ensureProjectSettings(gitInfo.rootPath);

  const [row] = await db
    .insert(projects)
    .values({
      id: randomUUID(),
      name: params.name,
      path: gitInfo.rootPath,
      gitRemote: gitInfo.remote ?? null,
      gitBranch: gitInfo.branch ?? null,
      baseRef: gitInfo.baseRef,
      githubRepository,
      githubConnected: githubConnected ? 1 : 0,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  return ok({
    type: 'local' as const,
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? gitInfo.baseRef, // fallback to computed value if DB returns null
    gitRemote: row.gitRemote ?? undefined,
    gitBranch: row.gitBranch ?? undefined,
    github: row.githubRepository
      ? { repository: row.githubRepository, connected: row.githubConnected === 1 }
      : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
