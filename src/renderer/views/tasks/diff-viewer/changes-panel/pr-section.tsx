import { ChevronDown, GitPullRequest } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { rpc } from '@renderer/core/ipc';
import { usePullRequests } from '@renderer/hooks/usePullRequests';
import { useCurrentProject } from '@renderer/views/projects/project-view-wrapper';
import { useTaskViewContext } from '../../task-view-context';
import { useBranchStatus } from '../state/use-branch-status.tsx';
import { parseGithubNameWithOwner } from '../utils';

export function PullRequestSection() {
  const { projectId, taskId } = useTaskViewContext();
  const project = useCurrentProject();
  const { data: branchData } = useBranchStatus({ projectId, taskId });

  const gitRemote = (project as { gitRemote?: string } | null)?.gitRemote;
  const nameWithOwner = gitRemote ? parseGithubNameWithOwner(gitRemote) : null;

  const { prs, refresh } = usePullRequests(nameWithOwner ?? undefined, !!nameWithOwner);

  const branch = branchData?.branch;
  const ahead = branchData?.ahead ?? 0;

  const existingPr = branch ? prs.find((pr) => pr.headRefName === branch) : undefined;

  const [isCreatingPr, setIsCreatingPr] = useState(false);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);

  const upstream = branchData?.upstream;
  const showSection = !!nameWithOwner && !!branch && (ahead > 0 || !!upstream || !!existingPr);
  if (!showSection) return null;

  const compareUrl = `https://github.com/${nameWithOwner}/compare/${branch}?expand=1`;

  const handleCreatePr = async (draft: boolean) => {
    draft ? setIsCreatingDraft(true) : setIsCreatingPr(true);
    try {
      const defaultBranchResult = await rpc.git.getDefaultBranch(projectId, taskId);
      const base =
        defaultBranchResult.success && defaultBranchResult.data?.name
          ? defaultBranchResult.data.name
          : 'main';

      const latestCommitResult = await rpc.git.getLatestCommit(projectId, taskId);
      const title =
        latestCommitResult.success && latestCommitResult.data?.commit?.subject
          ? latestCommitResult.data.commit.subject
          : branch;

      const result = await rpc.github.createPullRequest({
        nameWithOwner,
        head: branch,
        base,
        title,
        draft,
      });

      if (result.success && result.url) {
        refresh();
        rpc.app.openExternal(result.url);
      } else {
        rpc.app.openExternal(compareUrl);
      }
    } catch {
      rpc.app.openExternal(compareUrl);
    } finally {
      draft ? setIsCreatingDraft(false) : setIsCreatingPr(false);
    }
  };

  if (existingPr) {
    return (
      <div className="shrink-0 flex items-center justify-between  ">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => rpc.app.openExternal(existingPr.url)}
        >
          <GitPullRequest className="size-3" />
          View PR
          <Badge variant="secondary">{existingPr.isDraft ? 'Draft' : 'Open'}</Badge>
        </Button>
      </div>
    );
  }

  return (
    <div className="shrink-0 flex items-center gap-1">
      <Button
        variant="default"
        size="sm"
        className="flex-1"
        disabled={isCreatingPr}
        onClick={() => {
          void handleCreatePr(false);
        }}
      >
        <GitPullRequest className="size-3" />
        {isCreatingPr ? 'Creating...' : 'Create PR'}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="default"
              size="sm"
              className="px-1.5"
              disabled={isCreatingPr || isCreatingDraft}
            />
          }
        >
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onClick={() => {
              void handleCreatePr(true);
            }}
          >
            <GitPullRequest className="size-4" />
            Create Draft PR
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
