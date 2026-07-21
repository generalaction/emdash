import type { CheckoutHeadState, GitBranchRef } from '@emdash/core/runtimes/git/api';
import { useQuery } from '@tanstack/react-query';
import {
  asMounted,
  getProjectStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { readCheckoutHead } from '@core/features/source-control/api/browser/client';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';

export type ProjectGitContext = {
  defaultBranch: GitBranchRef | undefined;
  currentBranch: string | null;
  isUnborn: boolean;
  repositoryWorkspaceId: string | null;
};

function branchNameFromHead(head: CheckoutHeadState | undefined): string | null {
  if (!head || head.kind === 'detached') return null;
  return head.name;
}

export function useProjectGitContext(projectId: string | undefined): ProjectGitContext {
  const project = projectId ? asMounted(getProjectStore(projectId)) : undefined;
  const repo = projectId ? getGitRepositoryStore(projectId) : undefined;

  const headQuery = useQuery({
    queryKey: ['gitRepository', 'projectRootHead', projectId],
    enabled: !!project?.data.repositoryWorkspaceId,
    queryFn: async () => {
      if (!project?.data.repositoryWorkspaceId) throw new Error('Repository workspace required');
      return readCheckoutHead(project.data.repositoryWorkspaceId);
    },
    refetchOnWindowFocus: true,
  });

  const head = headQuery.data;
  return {
    defaultBranch: repo?.defaultBranch,
    currentBranch: branchNameFromHead(head),
    isUnborn: head?.kind === 'unborn',
    repositoryWorkspaceId: project?.data.repositoryWorkspaceId ?? null,
  };
}
