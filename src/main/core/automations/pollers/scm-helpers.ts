import type { ScmProvider } from '@shared/automations/events';
import { nameWithOwnerFromUrl } from '@shared/pull-requests';
import { isGitHubUrl } from '@main/core/github/services/utils';
import { getProjectById } from '@main/core/projects/operations/getProjects';
import { getProjectRemoteUrls } from '@main/core/pull-requests/project-remotes-service';

export type ProjectScmTarget = {
  projectId: string;
  projectPath: string;
  remoteUrl: string;
  /** GitHub-only: derived from the remote URL (e.g. "owner/repo"). */
  nameWithOwner?: string;
};

export function urlMatchesProvider(
  url: string,
  provider: ScmProvider,
  instanceUrl?: string
): boolean {
  if (provider === 'github') return isGitHubUrl(url);
  if (provider === 'gitlab') {
    if (instanceUrl) {
      try {
        return new URL(url).hostname === new URL(instanceUrl).hostname;
      } catch {
        return false;
      }
    }
    return /gitlab\./i.test(url);
  }
  if (provider === 'forgejo') {
    if (!instanceUrl) return false;
    try {
      return new URL(url).hostname === new URL(instanceUrl).hostname;
    } catch {
      return false;
    }
  }
  return false;
}

export async function listProjectScmTargets(
  projectId: string,
  provider: ScmProvider,
  instanceUrl?: string
): Promise<ProjectScmTarget[]> {
  const project = await getProjectById(projectId);
  if (!project || project.type !== 'local') return [];

  const urls = await getProjectRemoteUrls(projectId);
  const matching = urls.filter((url) => urlMatchesProvider(url, provider, instanceUrl));

  return matching.map((url) => ({
    projectId,
    projectPath: project.path,
    remoteUrl: url,
    nameWithOwner: provider === 'github' ? nameWithOwnerFromUrl(url) : undefined,
  }));
}
