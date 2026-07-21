import { observer } from 'mobx-react-lite';
import { gitCheckoutStoreToken } from '@core/features/source-control/contributions/browser/workspace-store-tokens';
import {
  useTaskComposition,
  useWorkspace,
} from '@core/features/workbench/api/browser/task-composition-context';
import { cn } from '@core/primitives/ui/browser/cn';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@core/primitives/ui/browser/resizable';
import { GitStatusSection } from '../../../../browser/diff-view/changes-panel/git-status-section';
import {
  SECTION_HEADER_HEIGHT,
  usePanelLayout,
} from '../../../../browser/diff-view/changes-panel/hooks/use-panel-layout';
import { PullRequestsSection } from '../../../../browser/diff-view/changes-panel/pr-section';
import { StagedSection } from '../../../../browser/diff-view/changes-panel/staged-section';
import { UnstagedSection } from '../../../../browser/diff-view/changes-panel/unstaged-section';

export const ChangesPanel = observer(function ChangesPanel() {
  const taskView = useTaskComposition();
  const workspace = useWorkspace();
  const diffView = taskView.diffView;
  const changesView = diffView?.changesView;

  const {
    expanded,
    toggleExpanded,
    panelTransitionClass,
    pointerHandlers,
    unstagedRef,
    stagedRef,
    prRef,
    spacerRef,
    containerRef,
  } = usePanelLayout(changesView ?? null, taskView.isChangesPanelVisible);

  if (!diffView || !changesView || !workspace.get(gitCheckoutStoreToken).hasData) return null;

  return (
    <div ref={containerRef} className="flex h-full flex-col">
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
