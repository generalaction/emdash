import type { GitHubViewerTeam } from '@shared/github';
import { teamReviewerId } from '@shared/pull-requests';
import { getOctokit } from './octokit-provider';

export async function getViewerTeams(): Promise<GitHubViewerTeam[]> {
  const octokit = await getOctokit();
  const teams = await octokit.paginate(octokit.rest.teams.listForAuthenticatedUser, {
    per_page: 100,
  });

  return teams.map((team) => ({
    teamId: teamReviewerId(team.id),
    slug: team.slug,
    name: team.name,
    organizationLogin: team.organization.login,
    avatarUrl: null,
    url: team.html_url ?? null,
  }));
}
