import { observer } from 'mobx-react-lite';
import { useWorkspace, useWorkspaceViewModel } from '@renderer/features/tasks/task-view-context';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { cn } from '@renderer/utils/utils';
import { SplitUnifiedToggle } from './components/split-unified-toggle';
import { GitStatusSection } from './git-status-section';
import { SECTION_HEADER_HEIGHT, usePanelLayout } from './hooks/use-panel-layout';
import { usePanelMode } from './hooks/use-panel-mode';
import { PullRequestsSection } from './pr-section';
import { StagedSection } from './staged-section';
import { UnifiedSection } from './unified-section';
import { UnstagedSection } from './unstaged-section';

export const ChangesPanel = observer(function ChangesPanel() {
  const taskView = useWorkspaceViewModel();
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
  } = usePanelLayout(changesView ?? null);

  const { mode: panelMode, setMode: setPanelMode } = usePanelMode();

  if (!diffView || !changesView || !workspace.git.hasData) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-border px-2">
        <SplitUnifiedToggle value={panelMode} onChange={setPanelMode} />
      </div>
      {panelMode === 'split' ? (
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
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <UnifiedSection />
        </div>
      )}
      <GitStatusSection />
    </div>
  );
});
