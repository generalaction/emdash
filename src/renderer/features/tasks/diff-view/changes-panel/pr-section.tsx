import { Plus, RefreshCw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { getPrSyncStore } from '@renderer/features/projects/stores/project-selectors';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { SplitButton, type SplitButtonAction } from '@renderer/lib/ui/split-button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { getRegisteredTaskData } from '../../stores/task-selectors';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '../../task-view-context';
import { ChangesViewModeToggle } from './components/changes-view-mode-toggle';
import { PullRequestEntry } from './components/pr-entry/pr-entry';
import { SectionHeader } from './components/section-header';
import { useChangesViewMode } from './hooks/use-changes-view-mode';

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
  const repositoryUrl = workspace.repository.repositoryUrl;
  const taskBranch = getRegisteredTaskData(projectId, taskId)?.taskBranch;
  const pullRequests = prStore?.pullRequests ?? [];
  const currentPr = prStore?.currentPr;
  const showCreatePrModal = useShowModal('createPrModal');

  const hasOpenPr = pullRequests.some((p) => p.status === 'open');
  const isRefreshing = repositoryUrl
    ? (getPrSyncStore(projectId)?.isSyncing(repositoryUrl) ?? false)
    : false;

  const onCreatePr = taskBranch
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

  const onCreateDraftPr = taskBranch
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

  const { mode: viewMode, setMode: setViewMode } = useChangesViewMode('pr');

  return (
    <>
      <SectionHeader
        label="Pull Requests"
        count={pullRequests.length}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        actions={
          <>
            <ChangesViewModeToggle
              value={viewMode}
              onChange={setViewMode}
              label="Pull request files"
            />
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
              <TooltipContent>
                {hasOpenPr ? 'A pull request is already open' : 'Create a pull request'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="outline"
                  size="icon-xs"
                  onClick={() => void rpc.pullRequests.syncPullRequests(projectId)}
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
        {!repositoryUrl ? (
          <EmptyState
            label="Pull requests unavailable"
            description="Pull requests are currently available only for configured GitHub remotes."
          />
        ) : pullRequests.length === 0 ? (
          <EmptyState
            label="No pull requests"
            description="Push your branch and create a PR to start a review."
          />
        ) : null}
        {repositoryUrl && currentPr && <PullRequestEntry key={currentPr.url} pr={currentPr} />}
      </div>
    </>
  );
});
