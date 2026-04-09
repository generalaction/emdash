import { observer } from 'mobx-react-lite';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { cn } from '@renderer/utils/utils';
import { GitStatusSection } from './git-status-section';
import { PullRequestEntry } from './pr-section/pr-section';
import { PullRequestSectionHeader } from './section-header';
import { StagedSection } from './staged-section';
import { UnstagedSection } from './unstaged-section';
import { SECTION_HEADER_HEIGHT, usePanelLayout } from './use-panel-layout';

export const ChangesPanel = observer(function ChangesPanel() {
  const changesView = useProvisionedTask().taskView.diffView.changesView;

  const {
    expanded,
    toggleExpanded,
    panelTransitionClass,
    pointerHandlers,
    unstagedRef,
    stagedRef,
    prRef,
    spacerRef,
  } = usePanelLayout(changesView);

  return (
    <div className="flex h-full flex-col">
      <ResizablePanelGroup
        orientation="vertical"
        className="min-h-0 flex-1"
        id="changes-panel-group"
        disableCursor
      >
        <ResizablePanel
          id="changes-unstaged"
          panelRef={unstagedRef}
          collapsible
          collapsedSize={SECTION_HEADER_HEIGHT}
          minSize="150px"
          maxSize="100%"
          defaultSize="33%"
          className={cn('flex flex-col overflow-hidden', panelTransitionClass)}
        >
          <UnstagedSection />
        </ResizablePanel>
        <ResizableHandle disabled={!expanded.unstaged || !expanded.staged} {...pointerHandlers} />
        <ResizablePanel
          id="changes-staged"
          panelRef={stagedRef}
          collapsible
          collapsedSize={SECTION_HEADER_HEIGHT}
          minSize="150px"
          maxSize="100%"
          defaultSize="33%"
          className={cn('flex flex-col overflow-hidden', panelTransitionClass)}
        >
          <StagedSection />
        </ResizablePanel>
        <ResizableHandle
          disabled={!expanded.staged || !expanded.pullRequests}
          {...pointerHandlers}
        />
        <ResizablePanel
          id="changes-pr"
          panelRef={prRef}
          collapsible
          collapsedSize={SECTION_HEADER_HEIGHT}
          minSize="150px"
          maxSize="100%"
          defaultSize="33%"
          className={cn('flex flex-col overflow-hidden', panelTransitionClass)}
        >
          <PullRequestsSection
            onToggleCollapsed={() => toggleExpanded('pullRequests')}
            collapsed={!expanded.pullRequests}
          />
        </ResizablePanel>
        <ResizablePanel
          id="changes-spacer"
          panelRef={spacerRef}
          minSize="0%"
          maxSize="100%"
          defaultSize="0%"
          className="border-t border-border"
        />
      </ResizablePanelGroup>
      <GitStatusSection />
    </div>
  );
});

const PullRequestsSection = observer(function PullRequestsSection({
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
