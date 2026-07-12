import { Plus, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { getPrSyncStore } from '@renderer/features/projects/stores/project-selectors';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { SplitButton, type SplitButtonAction } from '@renderer/lib/ui/split-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { pullRequestErrorMessage } from '@shared/core/pull-requests/pull-requests';
import { getTaskGitCheckoutStore } from '../../stores/task-selectors';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '../../task-view-context';
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
  const taskView = useWorkspaceViewModel();
  const prStore = taskView.prStore;
  const repositoryUrl = workspace.gitRepository.pullRequestRepositoryUrl;
  const taskBranch = getTaskGitCheckoutStore(projectId, taskId)?.branchName;
  const pullRequests = prStore?.pullRequests ?? [];
  const currentPr = prStore?.currentPr;
  const defaultBranch = workspace.gitRepository.defaultBranch;
  const headOid = workspace.gitCheckout.headOid;
  const branchCommitRange: CommitRange | undefined =
    !currentPr && defaultBranch?.oid && headOid && defaultBranch.oid !== headOid
      ? {
          source: 'branch',
          baseRefOid: defaultBranch.oid,
          headRefOid: headOid,
          revision: workspace.gitCheckout.statusRevision,
        }
      : undefined;
  const branchCommits = useCommits(projectId, workspaceId, branchCommitRange);
  const branchCommitCount = branchCommits.data?.pages[0]?.aheadCount;
  const showCreatePrModal = useShowModal('createPrModal');
  const { toast } = useToast();
  const prSyncStore = getPrSyncStore(projectId);

  const hasOpenPr = pullRequests.some((p) => p.status === 'open');
  const isRefreshing = repositoryUrl ? (prSyncStore?.isSyncing(repositoryUrl) ?? false) : false;
  const syncState = repositoryUrl ? prSyncStore?.getState(repositoryUrl) : undefined;
  const syncError = syncState?.status === 'error' ? (syncState.error ?? 'Sync failed') : null;

  const onCreatePr =
    taskBranch && repositoryUrl
      ? () =>
          showCreatePrModal({
            projectId,
            taskId,
            repositoryUrl: repositoryUrl ?? '',
            branchName: taskBranch,
            draft: false,
            workspaceId,
            onSuccess: () => {},
          })
      : undefined;

  const onCreateDraftPr =
    taskBranch && repositoryUrl
      ? () =>
          showCreatePrModal({
            projectId,
            taskId,
            repositoryUrl: repositoryUrl ?? '',
            branchName: taskBranch,
            draft: true,
            workspaceId,
            onSuccess: () => {},
          })
      : undefined;

  const prActions: SplitButtonAction[] = [
    { value: 'create-pr', label: 'Create PR', action: () => onCreatePr?.() },
    { value: 'create-draft-pr', label: 'Create draft PR', action: () => onCreateDraftPr?.() },
  ];

  const handleRefresh = async () => {
    try {
      const result = await rpc.pullRequests.syncPullRequests(projectId);
      if (!result.success) {
        toast({
          title: 'Failed to refresh pull requests',
          description: pullRequestErrorMessage(result.error),
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Failed to refresh pull requests',
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
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
