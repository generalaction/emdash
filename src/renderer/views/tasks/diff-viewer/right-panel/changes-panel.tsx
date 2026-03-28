import { observer } from 'mobx-react-lite';
import { EmptyState } from '@renderer/components/ui/empty-state';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { cn } from '@renderer/lib/utils';
import { usePrContext } from '@renderer/views/tasks/diff-viewer/state/pr-provider';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';
import { GitStatusSection } from './git-status-section';
import { PullRequestEntry } from './pr-section/pr-section';
import { PullRequestSectionHeader } from './section-header';
import { StagedSection } from './staged-section';
import { UnstagedSection } from './unstaged-section';
import { SECTION_HEADER_HEIGHT, usePanelLayout } from './use-panel-layout';

export const ChangesPanel = observer(function ChangesPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const changesView = asProvisioned(getTaskStore(projectId, taskId))!.diffView.changesView;

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

function PullRequestsSection({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const { pullRequests, nameWithOwner, taskBranch } = usePrContext();
  const showCreatePrModal = useShowModal('createPrModal');

  return (
    <>
      <PullRequestSectionHeader
        count={pullRequests.length}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
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
        {pullRequests.length === 0 && (
          <EmptyState
            label="No pull requests"
            description="Push your branch and create a PR to start a review."
          />
        )}
        {pullRequests.map((pr) => (
          <PullRequestEntry key={pr.id} pr={pr} />
        ))}
      </div>
    </>
  );
}
