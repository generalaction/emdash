import { parseGitHubRepository } from '@shared/github-repository';
import { githubIssueProvider } from '@main/core/github/github-issue-provider';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import { getProjectRemoteUrls } from '@main/core/pull-requests/project-remotes-service';
import { diffIssuesAgainstCursor } from './issue-helpers';
import type { Poller, PollerCursor, PollerResult } from './types';

async function listProjectGithubRepos(projectId: string): Promise<string[]> {
  const project = await getProjectById(projectId);
  if (!project || project.type !== 'local') return [];
  const urls = await getProjectRemoteUrls(projectId);
  const repos: string[] = [];
  for (const url of urls) {
    const repository = parseGitHubRepository(url);
    if (repository) repos.push(repository.repositoryUrl);
  }
  return repos;
}

export const githubPoller: Poller = {
  async poll(projectId: string, cursor: PollerCursor | null): Promise<PollerResult> {
    return diffIssuesAgainstCursor(projectId, cursor, async () => {
      const repos = await listProjectGithubRepos(projectId);
      if (repos.length === 0) return { ok: true, issues: [] };

      const results = await Promise.all(
        repos.map((repositoryUrl) =>
          githubIssueProvider.listIssues({
            projectId,
            repositoryUrl,
            limit: 50,
          })
        )
      );

      const collected = results.flatMap((result) => (result.success ? result.issues : []));
      return { ok: true, issues: collected };
    });
  },
};
