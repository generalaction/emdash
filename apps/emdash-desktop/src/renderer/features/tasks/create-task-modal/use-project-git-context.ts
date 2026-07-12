import type { CheckoutHeadState, GitBranchRef } from '@emdash/core/git';
import { useQuery } from '@tanstack/react-query';
import {
  asMounted,
  getGitRepositoryStore,
  getProjectStore,
} from '@renderer/features/projects/stores/project-selectors';
import { readCheckoutHead } from '@renderer/lib/runtime/git';

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
    enabled: !!projectId && project?.data.type === 'local',
    queryFn: async () => {
      if (!project || project.data.type !== 'local') throw new Error('Local project required');
      return readCheckoutHead(project.data.path);
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
