import { nameWithOwnerFromUrl } from '@shared/pull-requests';
import { githubIssueProvider } from '@main/core/github/github-issue-provider';
import { isGitHubUrl } from '@main/core/github/services/utils';
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
    if (!isGitHubUrl(url)) continue;
    const nameWithOwner = nameWithOwnerFromUrl(url);
    if (nameWithOwner) repos.push(nameWithOwner);
  }
  return repos;
}

export const githubPoller: Poller = {
  async poll(projectId: string, cursor: PollerCursor | null): Promise<PollerResult> {
    return diffIssuesAgainstCursor(projectId, cursor, async () => {
      const repos = await listProjectGithubRepos(projectId);
      if (repos.length === 0) return { ok: true, issues: [] };

      const results = await Promise.all(
        repos.map((nameWithOwner) =>
          githubIssueProvider.listIssues({
            projectId,
            nameWithOwner,
            limit: 50,
          })
        )
      );

      const collected = results.flatMap((result) => (result.success ? result.issues : []));
      return { ok: true, issues: collected };
    });
  },
};
