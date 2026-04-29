import type { Remote } from '@shared/git';
import { log } from '@main/lib/logger';
import { getOctokit } from './octokit-provider';
import { isGitHubUrl, normalizeGitHubUrl, splitNormalizedUrl } from './utils';

export type ForkDetectionResult = {
  forkRemoteName: string;
  upstreamRemoteName: string;
  upstreamOwnerRepo: string;
};

export async function detectForkRelationship(
  remotes: Remote[]
): Promise<ForkDetectionResult | null> {
  const githubRemotes = remotes.filter((r) => isGitHubUrl(r.url));
  if (githubRemotes.length < 2) return null;

  const ordered = [
    ...githubRemotes.filter((r) => r.name === 'origin'),
    ...githubRemotes.filter((r) => r.name !== 'origin'),
  ];

  try {
    const octokit = await getOctokit();

    for (const candidate of ordered) {
      const normalizedUrl = normalizeGitHubUrl(candidate.url);
      const { owner, repo } = splitNormalizedUrl(normalizedUrl);
      const { data } = await octokit.rest.repos.get({ owner, repo });

      if (!data.fork || !data.parent) continue;

      const parentUrl = normalizeGitHubUrl(data.parent.html_url);
      const matchingUpstream = remotes.find(
        (r) => r.name !== candidate.name && normalizeGitHubUrl(r.url) === parentUrl
      );

      if (!matchingUpstream) continue;

      return {
        forkRemoteName: candidate.name,
        upstreamRemoteName: matchingUpstream.name,
        upstreamOwnerRepo: data.parent.full_name,
      };
    }

    return null;
  } catch (e) {
    log.warn('Fork detection failed', { error: String(e) });
    return null;
  }
}
