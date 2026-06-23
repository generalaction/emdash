import type { ConnectionStatus } from '@shared/issue-providers';

export type ProviderContext = { projectPath?: string; repositoryUrl?: string };

export function isProviderUsable(
  status: ConnectionStatus | undefined,
  context: ProviderContext
): boolean {
  if (!status?.connected) return false;
  if (status.capabilities.requiresProjectPath && !context.projectPath) return false;
  if (status.capabilities.requiresRepositoryUrl && !context.repositoryUrl) return false;
  return true;
}
