import type { CheckoutHeadState, GitBranchRef } from '@emdash/core/runtimes/git/api';
import { useQuery } from '@tanstack/react-query';
import {
  asMounted,
  getProjectStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import {
  inspectProjectPath,
  readCheckoutHead,
} from '@core/features/source-control/api/browser/client';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';

export type ProjectGitContext = {
  defaultBranch: GitBranchRef | undefined;
  currentBranch: string | null;
  isUnborn: boolean;
  hasRepository: boolean;
  repositoryWorkspaceId: string | null;
};

function branchNameFromHead(head: CheckoutHeadState | undefined): string | null {
  if (!head || head.kind === 'detached') return null;
  return head.name;
}

export function useProjectGitContext(projectId: string | undefined): ProjectGitContext {
  const project = projectId ? asMounted(getProjectStore(projectId)) : undefined;
  const repo = projectId ? getGitRepositoryStore(projectId) : undefined;

  const pathInspectionQuery = useQuery({
    queryKey: ['projectPathStatus', 'taskConfig', projectId, project?.data.path],
    enabled: !!project,
    queryFn: async () => {
      if (!project) throw new Error('Project is not mounted');
      return project.data.type === 'ssh'
        ? inspectProjectPath({
            type: 'ssh',
            connectionId: project.data.connectionId,
            path: project.data.path,
          })
        : inspectProjectPath({
            type: 'local',
            path: project.data.path,
          });
    },
    refetchOnWindowFocus: true,
  });

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
    hasRepository: pathInspectionQuery.data?.error
      ? true
      : (pathInspectionQuery.data?.isGitRepo ?? true),
    repositoryWorkspaceId: project?.data.repositoryWorkspaceId ?? null,
  };
}
