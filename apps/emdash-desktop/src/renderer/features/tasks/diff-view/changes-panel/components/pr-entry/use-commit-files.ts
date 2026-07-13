import type { GitChange } from '@emdash/core/runtimes/git/api';
import { useQuery } from '@tanstack/react-query';
import { workspaceRegistry } from '@renderer/features/tasks/stores/workspace-registry';
import { checkoutSelector } from '@renderer/lib/runtime/git';
import { getGitRuntimeClient } from '@renderer/lib/runtime/git-client';

export const commitFilesQueryKey = (projectId: string, workspaceId: string, commitHash: string) =>
  [projectId, workspaceId, 'commit-files', commitHash] as const;

export function useCommitFiles(
  projectId: string,
  workspaceId: string,
  commitHash: string,
  enabled: boolean
) {
  return useQuery({
    queryKey: commitFilesQueryKey(projectId, workspaceId, commitHash),
    queryFn: async (): Promise<GitChange[]> => {
      const workspace = workspaceRegistry.get(projectId, workspaceId);
      if (!workspace) throw new Error('Workspace is unavailable');
      const client = await getGitRuntimeClient();
      const result = await client.checkout.getCommitFiles({
        ...checkoutSelector(workspace.path),
        hash: commitHash,
      });
      if (!result.success) throw new Error('Failed to load commit files');
      return result.data;
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}
