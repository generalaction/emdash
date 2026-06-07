import type { LinkedIssue } from '@shared/core/linked-issue';
import type { ConnectionStatus } from '@shared/issue-providers';
import { isGitHubDotComHost } from '@shared/repository-ref';

export function isProviderUsable(
  provider: LinkedIssue['provider'],
  status: ConnectionStatus | undefined,
  context: { projectPath?: string; repositoryUrl?: string },
  githubIssueHost: string | null
): boolean {
  if (provider === 'github' && githubIssueHost && !isGitHubDotComHost(githubIssueHost)) return true;
  if (!status?.connected) return false;
  if (status.capabilities.requiresProjectPath && !context.projectPath) return false;
  if (status.capabilities.requiresRepositoryUrl && !context.repositoryUrl) return false;
  return true;
}
