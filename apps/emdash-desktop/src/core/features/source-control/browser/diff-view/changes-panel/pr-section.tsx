import { EmptyState } from '@emdash/ui/react/components';
import { Button, SplitButton, Tooltip, useToast } from '@emdash/ui/react/primitives';
import { Plus, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import {
  asAvailableProject,
  getProjectStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { getTaskGitCheckoutStore } from '@core/features/source-control/api/browser/stores/task-source-control-selectors';
import { gitCheckoutStoreToken } from '@core/features/source-control/contributions/browser/workspace-store-tokens';
import { useTaskViewContext } from '@core/features/tasks/contributions/browser/task-view-context';
import {
  useTaskComposition,
  useWorkspace,
  useWorkspaceId,
} from '@core/features/workbench/api/browser/task-composition-context';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { projectAvailabilityUi } from '@core/manifests/browser/project-availability-ui';
import { cn } from '@core/primitives/styling/browser/cn';
import { pullRequestErrorMessage } from '@core/services/pull-requests/api';
import { getPullRequestsRuntimeClient } from '@core/services/pull-requests/api/client';
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

/**
 * Facts shared by the section header (label, count, actions) and the body.
 * Header and body are separate components in the sections group, so each calls
 * this hook; the underlying react-query cache dedupes the commit lookups.
 */
function usePullRequestsSectionModel() {
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const workspace = useWorkspace();
  const taskView = useTaskComposition();
  const prStore = taskView.prStore;
  const repository = getGitRepositoryStore(projectId);
  const repositoryUrl = repository?.pullRequestRepositoryUrl ?? null;
  const provider = repository?.providerRepository?.provider ?? 'github';
  const providerRepositoryObservation = repository?.providerRepositoryObservation ?? {
    kind: 'unavailable' as const,
  };
  const taskBranch = getTaskGitCheckoutStore(projectId, taskId)?.branchName;
  const pullRequests = prStore?.pullRequests ?? [];
  const pullRequestsObservation = prStore?.pullRequestsObservation ?? {
    kind: 'unavailable' as const,
  };
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
        }
      : undefined;
  const branchCommits = useCommits(projectId, workspaceId, branchCommitRange);
  const branchCommitCount = branchCommits.data?.pages[0]?.aheadCount;

  const showBranchCommits =
    !!branchCommitRange && branchCommitCount !== undefined && branchCommitCount > 0;

  return {
    projectId,
    taskId,
    workspaceId,
    repositoryUrl,
    provider,
    providerRepositoryObservation,
    taskBranch,
    pullRequests,
    pullRequestsObservation,
    currentPr,
    branchCommitRange,
    showBranchCommits,
    sectionLabel: showBranchCommits
      ? 'Branch Commits'
      : provider === 'gitlab'
        ? 'Merge Requests'
        : 'Pull Requests',
    sectionCount: showBranchCommits ? (branchCommitCount ?? 0) : pullRequests.length,
  };
}

/** Always-visible header row; rendered as a direct child of the sections group. */
export const PullRequestsSectionHeader = observer(function PullRequestsSectionHeader({
  onSyncError,
}: {
  onSyncError: (message: string | null) => void;
}) {
  const taskView = useTaskComposition();
  const changesView = taskView.diffView?.changesView;
  const {
    projectId,
    taskId,
    workspaceId,
    repositoryUrl,
    provider,
    taskBranch,
    pullRequests,
    currentPr,
    showBranchCommits,
    sectionLabel,
    sectionCount,
  } = usePullRequestsSectionModel();
  const openCreatePrModal = useOpenModal('createPrModal');
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { mode: viewMode, setMode: setViewMode } = useChangesViewMode('pr');
  const { mode: commitsViewMode, setMode: setCommitsViewMode } = useChangesViewMode('commits');
  const context = asAvailableProject(getProjectStore(projectId));
  const hostActionReason = context
    ? projectAvailabilityUi.getLiveActionDisabledReason(projectId)
    : 'Unavailable until access to this Project is restored.';
  const hostActionDisabled = hostActionReason !== null;

  const short = provider === 'gitlab' ? 'MR' : 'PR';
  const noun = provider === 'gitlab' ? 'merge request' : 'pull request';
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

  const prActions = [
    { id: 'create-pr', label: `Create ${short}`, action: () => onCreatePr?.() },
    { id: 'create-draft-pr', label: `Create draft ${short}`, action: () => onCreateDraftPr?.() },
  ];
  const [selectedPrActionId, setSelectedPrActionId] = useState<string | undefined>(undefined);

  const handleRefresh = async () => {
    if (hostActionDisabled || !repositoryUrl) return;
    setIsRefreshing(true);
    onSyncError(null);
    try {
      const client = await getPullRequestsRuntimeClient();
      const result = await client.refreshRepository({ repositoryUrl, policy: 'force' });
      if (!result.success) {
        const message = pullRequestErrorMessage(result.error);
        onSyncError(message);
        toast.error(`Failed to refresh ${noun}s`, { description: message });
      }
    } catch (error) {
      toast.error(`Failed to refresh ${noun}s`, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const createPrTooltip = !repositoryUrl
    ? `${provider === 'gitlab' ? 'Merge' : 'Pull'} requests unavailable`
    : hostActionReason
      ? hostActionReason
      : hasOpenPr
        ? `A ${noun} is already open`
        : `Create a ${noun}`;

  if (!changesView) return null;

  return (
    <SectionHeader
      label={sectionLabel}
      count={sectionCount}
      collapsed={!changesView.expandedSections.pullRequests}
      onToggleCollapsed={() => changesView.toggleExpanded('pullRequests')}
      actions={
        <>
          {currentPr && (
            <ChangesViewModeToggle
              value={viewMode}
              onChange={setViewMode}
              label={provider === 'gitlab' ? 'Merge request files' : 'Pull request files'}
            />
          )}
          {showBranchCommits && (
            <ChangesViewModeToggle
              value={commitsViewMode}
              onChange={setCommitsViewMode}
              label="Branch commits"
            />
          )}
          {
            <Tooltip.Root>
              <Tooltip.Trigger
                render={
                  <SplitButton
                    variant="secondary"
                    size="xs"
                    options={prActions.map(({ id, label }) => ({ id, label }))}
                    selectedId={selectedPrActionId}
                    onSelectedChange={setSelectedPrActionId}
                    commitOnSelect={false}
                    onAction={(id) => {
                      if (!hostActionDisabled) prActions.find((a) => a.id === id)?.action();
                    }}
                    disabled={hasOpenPr || !onCreatePr || !onCreateDraftPr}
                    aria-disabled={hostActionDisabled}
                    aria-description={hostActionReason ?? undefined}
                    icon={<Plus className="size-3" />}
                  />
                }
              />
              <Tooltip.Content>{createPrTooltip}</Tooltip.Content>
            </Tooltip.Root>
          }
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <Button
                  variant="secondary"
                  size="xs"
                  icon
                  onClick={() => void handleRefresh()}
                  disabled={isRefreshing}
                  aria-disabled={hostActionDisabled}
                  aria-description={hostActionReason ?? undefined}
                >
                  <RefreshCw className={cn('size-3', isRefreshing && 'animate-spin')} />
                </Button>
              }
            />
            <Tooltip.Content>
              {hostActionReason ??
                (provider === 'gitlab' ? 'Refresh merge requests' : 'Refresh pull requests')}
            </Tooltip.Content>
          </Tooltip.Root>
        </>
      }
    />
  );
});

/** Section body; mounted inside a Resizable.Panel only while the section is expanded. */
export const PullRequestsSectionBody = observer(function PullRequestsSectionBody({
  syncError,
}: {
  syncError: string | null;
}) {
  const {
    repositoryUrl,
    provider,
    providerRepositoryObservation,
    pullRequests,
    pullRequestsObservation,
    currentPr,
    branchCommitRange,
    showBranchCommits,
  } = usePullRequestsSectionModel();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {pullRequestsObservation.kind === 'stale' ? (
        <p
          role="status"
          className="border-t border-border px-2.5 py-2 text-xs text-foreground-muted"
        >
          Showing previously observed {provider === 'gitlab' ? 'merge requests' : 'pull requests'}
        </p>
      ) : null}
      {currentPr ? (
        <PullRequestEntry key={currentPr.url} pr={currentPr} />
      ) : showBranchCommits && branchCommitRange ? (
        <BranchCommitsEntry range={branchCommitRange} />
      ) : providerRepositoryObservation.kind === 'unavailable' ? (
        <EmptyState
          label="Repository details unavailable"
          description="Provider repository data has not been observed for this Project yet."
        />
      ) : !repositoryUrl ? (
        <EmptyState
          label={provider === 'gitlab' ? 'Merge requests unavailable' : 'Pull requests unavailable'}
          description={
            provider === 'gitlab'
              ? 'Merge requests are unavailable for this remote.'
              : 'Pull requests are currently available only for configured GitHub remotes.'
          }
        />
      ) : pullRequestsObservation.kind === 'unavailable' ? (
        <EmptyState
          label={provider === 'gitlab' ? 'Merge requests unavailable' : 'Pull requests unavailable'}
          description={
            provider === 'gitlab'
              ? 'Merge request data has not been observed for this Project yet.'
              : 'Pull request data has not been observed for this Project yet.'
          }
        />
      ) : pullRequests.length === 0 ? (
        <EmptyState
          label={
            provider === 'gitlab'
              ? syncError
                ? 'Could not load merge requests'
                : 'No merge requests'
              : syncError
                ? 'Could not load pull requests'
                : 'No pull requests'
          }
          description={
            syncError ??
            (provider === 'gitlab'
              ? 'Push your branch and create an MR to start a review.'
              : 'Push your branch and create a PR to start a review.')
          }
        />
      ) : null}
    </div>
  );
});

function BranchCommitsEntry({ range }: { range: CommitRange }) {
  const { mode: viewMode } = useChangesViewMode('commits');
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      <div className="min-h-0 flex-1 px-2.5">
        <CommitRangeCommitsList
          range={range}
          emptyState={BRANCH_COMMITS_EMPTY_STATE}
          viewMode={viewMode}
        />
      </div>
    </div>
  );
}
