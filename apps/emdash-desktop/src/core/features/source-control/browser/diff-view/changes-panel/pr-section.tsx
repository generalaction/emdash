import { Plus, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { gitCheckoutStoreToken } from '@core/features/source-control/browser/contributions/workspace-store-tokens';
import { getGitRepositoryStore } from '@core/features/source-control/browser/stores/source-control-selectors';
import { getTaskGitCheckoutStore } from '@core/features/source-control/browser/stores/task-source-control-selectors';
import { useTaskViewContext } from '@core/features/tasks/browser/task-view-context';
import {
  useTaskComposition,
  useWorkspace,
  useWorkspaceId,
} from '@core/features/workbench/browser/task-composition-context';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useOpenModal } from '@renderer/lib/modal/api';
import { getPullRequestsRuntimeClient } from '@renderer/lib/runtime/pull-requests-client';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { SplitButton, type SplitButtonAction } from '@renderer/lib/ui/split-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { pullRequestErrorMessage } from '@root/src/core/services/pull-requests/api';
import { ChangesViewModeToggle } from './components/changes-view-mode-toggle';
import { CommitRangeCommitsList } from './components/pr-entry/commits-list';
import { PullRequestEntry } from './components/pr-entry/pr-entry';
import { type CommitRange, useCommits } from './components/pr-entry/use-commits';
import { SectionHeader } from './components/section-header';
import { useChangesViewMode } from './hooks/use-changes-view-mode';

const BRANCH_COMMITS_EMPTY_STATE = {
  label: 'No commits',
  description: 'No commits ahead of the base branch.',
};

export const PullRequestsSection = observer(function PullRequestsSection({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const workspace = useWorkspace();
  const taskView = useTaskComposition();
  const prStore = taskView.prStore;
  const repository = getGitRepositoryStore(projectId);
  const repositoryUrl = repository?.pullRequestRepositoryUrl ?? null;
  const taskBranch = getTaskGitCheckoutStore(projectId, taskId)?.branchName;
  const pullRequests = prStore?.pullRequests ?? [];
  const currentPr = prStore?.currentPr;
  const defaultBranch = repository?.defaultBranch;
  const gitCheckout = workspace.get(gitCheckoutStoreToken);
  const headOid = gitCheckout.headOid;
  const branchCommitRange: CommitRange | undefined =
    !currentPr && defaultBranch?.oid && headOid && defaultBranch.oid !== headOid
      ? {
          source: 'branch',
          baseRefOid: defaultBranch.oid,
          headRefOid: headOid,
          revision: gitCheckout.statusRevision,
        }
      : undefined;
  const branchCommits = useCommits(projectId, workspaceId, branchCommitRange);
  const branchCommitCount = branchCommits.data?.pages[0]?.aheadCount;
  const openCreatePrModal = useOpenModal('createPrModal');
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const hasOpenPr = pullRequests.some((p) => p.status === 'open');

  const onCreatePr =
    taskBranch && repositoryUrl
      ? () => {
          void openCreatePrModal({
            projectId,
            taskId,
            repositoryUrl: repositoryUrl ?? '',
            branchName: taskBranch,
            draft: false,
            workspaceId,
          });
        }
      : undefined;

  const onCreateDraftPr =
    taskBranch && repositoryUrl
      ? () => {
          void openCreatePrModal({
            projectId,
            taskId,
            repositoryUrl: repositoryUrl ?? '',
            branchName: taskBranch,
            draft: true,
            workspaceId,
          });
        }
      : undefined;

  const prActions: SplitButtonAction[] = [
    { value: 'create-pr', label: 'Create PR', action: () => onCreatePr?.() },
    { value: 'create-draft-pr', label: 'Create draft PR', action: () => onCreateDraftPr?.() },
  ];

  const handleRefresh = async () => {
    if (!repositoryUrl) return;
    setIsRefreshing(true);
    setSyncError(null);
    try {
      const client = await getPullRequestsRuntimeClient();
      const result = await client.sync({ repositoryUrl });
      if (!result.success) {
        const message = pullRequestErrorMessage(result.error);
        setSyncError(message);
        toast({
          title: 'Failed to refresh pull requests',
          description: message,
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Failed to refresh pull requests',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const { mode: viewMode, setMode: setViewMode } = useChangesViewMode('pr');
  const showBranchCommits =
    !!branchCommitRange && branchCommitCount !== undefined && branchCommitCount > 0;
  const sectionLabel = showBranchCommits ? 'Branch Commits' : 'Pull Requests';
  const sectionCount = showBranchCommits ? (branchCommitCount ?? 0) : pullRequests.length;
  const createPrTooltip = !repositoryUrl
    ? 'Pull requests unavailable'
    : hasOpenPr
      ? 'A pull request is already open'
      : 'Create a pull request';

  return (
    <>
      <SectionHeader
        label={sectionLabel}
        count={sectionCount}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        actions={
          <>
            {currentPr && (
              <ChangesViewModeToggle
                value={viewMode}
                onChange={setViewMode}
                label="Pull request files"
              />
            )}
            <Tooltip>
              <TooltipTrigger>
                <SplitButton
                  variant="outline"
                  size="xs"
                  actions={prActions}
                  disabled={hasOpenPr || !onCreatePr || !onCreateDraftPr}
                  icon={<Plus className="size-3" />}
                />
              </TooltipTrigger>
              <TooltipContent>{createPrTooltip}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={() => void handleRefresh()}
                  disabled={isRefreshing}
                >
                  <RefreshCw className={cn('size-3', isRefreshing && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh pull requests</TooltipContent>
            </Tooltip>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {currentPr ? (
          <PullRequestEntry key={currentPr.url} pr={currentPr} />
        ) : showBranchCommits ? (
          <BranchCommitsEntry range={branchCommitRange} />
        ) : !repositoryUrl ? (
          <EmptyState
            label="Pull requests unavailable"
            description="Pull requests are currently available only for configured GitHub remotes."
          />
        ) : pullRequests.length === 0 ? (
          <EmptyState
            label={syncError ? 'Could not load pull requests' : 'No pull requests'}
            description={syncError ?? 'Push your branch and create a PR to start a review.'}
          />
        ) : null}
      </div>
    </>
  );
});

function BranchCommitsEntry({ range }: { range: CommitRange }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="min-h-0 flex-1 px-2.5">
        <CommitRangeCommitsList range={range} emptyState={BRANCH_COMMITS_EMPTY_STATE} />
      </div>
    </div>
  );
}
