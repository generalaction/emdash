import type { GitHeadModel } from '@emdash/shared/git';
import { useQuery } from '@tanstack/react-query';
import {
  asMounted,
  getGitRepositoryStore,
  getProjectStore,
} from '@renderer/features/projects/stores/project-selectors';
import { rpc } from '@renderer/lib/ipc';
import type { Branch } from '@shared/core/git/git';

export type ProjectGitContext = {
  defaultBranch: Branch | undefined;
  currentBranch: string | null;
  isUnborn: boolean;
  repositoryWorkspaceId: string | null;
};

function branchNameFromHead(head: GitHeadModel | undefined): string | null {
  if (!head || head.kind === 'detached') return null;
  return head.name;
}

export function useProjectGitContext(projectId: string | undefined): ProjectGitContext {
  const project = projectId ? asMounted(getProjectStore(projectId)) : undefined;
  const repo = projectId ? getGitRepositoryStore(projectId) : undefined;

  const headQuery = useQuery({
    queryKey: ['gitRepository', 'projectRootHead', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const result = await rpc.gitRepository.getProjectRootHead(projectId!);
      if (!result.success) throw new Error(result.error.type);
      return result.data.head;
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
