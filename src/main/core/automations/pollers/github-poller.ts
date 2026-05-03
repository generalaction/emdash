import { parseGitHubRepository, type GitHubRepositoryRef } from '@shared/github-repository';
import { issueService, type GitHubIssue } from '@main/core/github/services/issue-service';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import { getProjectRemoteUrls } from '@main/core/pull-requests/project-remotes-service';
import { diffIssuesAgainstCursor } from './issue-helpers';
import type { Poller, PollerCursor, PollerResult, RepoEventState } from './types';

/** Overlap window subtracted from `since` to absorb clock skew between us and GitHub. */
const SINCE_OVERLAP_MS = 60_000;

async function listProjectGithubRepos(projectId: string): Promise<GitHubRepositoryRef[]> {
  const project = await getProjectById(projectId);
  if (!project || project.type !== 'local') return [];
  const urls = await getProjectRemoteUrls(projectId);
  const repos: GitHubRepositoryRef[] = [];
  for (const url of urls) {
    const repository = parseGitHubRepository(url);
    if (repository) repos.push(repository);
  }
  return repos;
}

function sinceFor(state: RepoEventState | undefined): string | undefined {
  if (!state?.lastSyncedAt) return undefined;
  const t = Date.parse(state.lastSyncedAt);
  if (Number.isNaN(t)) return undefined;
  return new Date(Math.max(0, t - SINCE_OVERLAP_MS)).toISOString();
}

export const githubPoller: Poller = {
  async poll(projectId: string, cursor: PollerCursor | null): Promise<PollerResult> {
    const repos = await listProjectGithubRepos(projectId);
    const prevStates = cursor?.repoStates ?? {};
    const nextStates: Record<string, RepoEventState> = {};
    const collected: GitHubIssue[] = [];
    let allOk = repos.length > 0;

    for (const repo of repos) {
      const key = repo.repositoryUrl;
      const prev = prevStates[key];
      const result = await issueService.listIssuesForPolling(repo, {
        limit: 50,
        since: sinceFor(prev),
        etag: prev?.etag,
      });
      if (!result.ok) allOk = false;
      collected.push(...result.issues);
      nextStates[key] = {
        etag: result.etag ?? prev?.etag,
        lastSyncedAt: new Date().toISOString(),
      };
    }

    const diff = await diffIssuesAgainstCursor(projectId, cursor, async () => ({
      ok: allOk,
      issues: collected,
    }));
    return {
      events: diff.events,
      cursor: { ...diff.cursor, repoStates: nextStates },
    };
  },
};
