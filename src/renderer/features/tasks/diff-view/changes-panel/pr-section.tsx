import { observer } from 'mobx-react-lite';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { useProvisionedTask } from '../../task-view-context';
import { PullRequestEntry } from './components/pr-entry/pr-entry';
import { PullRequestSectionHeader } from './components/section-header';

export const PullRequestsSection = observer(function PullRequestsSection({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const provisioned = useProvisionedTask();
  const { pr, nameWithOwner: nwoResource } = provisioned.workspace;
  const nameWithOwner = nwoResource.data ?? null;
  const taskBranch = provisioned.taskBranch;
  const { pullRequests } = pr;
  const showCreatePrModal = useShowModal('createPrModal');

  const activePr = pullRequests.find((pr) => pr.status === 'open') || pullRequests[0];

  const hasOpenPr = Boolean(activePr);
  const hasUpstream = provisioned.workspace.git.isBranchPublished;

  return (
    <>
      <PullRequestSectionHeader
        count={pullRequests.length}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        hasUpstream={hasUpstream}
        hasOpenPr={hasOpenPr}
        onCreatePr={
          taskBranch
            ? () =>
                showCreatePrModal({
                  nameWithOwner: nameWithOwner ?? '',
                  branchName: taskBranch,
                  draft: false,
                  onSuccess: () => {},
                })
            : undefined
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!nameWithOwner ? (
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
        {nameWithOwner && activePr && <PullRequestEntry key={activePr.id} pr={activePr} />}
      </div>
    </>
  );
});
