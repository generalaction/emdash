import { observer } from 'mobx-react-lite';
import { getPrSyncStore } from '@renderer/features/projects/stores/project-selectors';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { useProvisionedTask, useTaskViewContext } from '../../task-view-context';
import { PullRequestEntry } from './components/pr-entry/pr-entry';
import { PullRequestSectionHeader } from './components/section-header';

export const PullRequestsSection = observer(function PullRequestsSection({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { pr } = provisioned.workspace;
  const repositoryUrl = provisioned.repositoryStore.repositoryUrl;
  const taskBranch = provisioned.taskBranch;
  const { pullRequests, currentPr } = pr;
  const showCreatePrModal = useShowModal('createPrModal');

  const hasOpenPr = pullRequests.some((p) => p.status === 'open');
  const isRefreshing = repositoryUrl
    ? (getPrSyncStore(projectId)?.isSyncing(repositoryUrl) ?? false)
    : false;

  return (
    <>
      <PullRequestSectionHeader
        count={pullRequests.length}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        hasOpenPr={hasOpenPr}
        onCreatePr={
          taskBranch
            ? () =>
                showCreatePrModal({
                  nameWithOwner: repositoryUrl ?? '',
                  pushRepositoryUrl: provisioned.repositoryStore.pushRepositoryUrl,
                  branchName: taskBranch,
                  draft: false,
                  workspaceId: provisioned.workspaceId,
                  onSuccess: () => {},
                })
            : undefined
        }
        onRefresh={() => {
          void rpc.pullRequests.syncPullRequests(projectId);
        }}
        isRefreshing={isRefreshing}
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
