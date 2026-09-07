import type { ConnectionStatus } from '@core/primitives/issue-providers/api';

export type ProviderContext = { projectPath?: string; repositoryUrl?: string };

export function isProviderUsable(
  status: ConnectionStatus | undefined,
  context: ProviderContext
): boolean {
  if (!status?.connected) return false;
  if (status.capabilities.requiresRepositoryUrl && !context.repositoryUrl) return false;
  return true;
}
