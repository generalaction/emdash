import { observer } from 'mobx-react-lite';
import type { DiffViewStore } from '@renderer/features/tasks/diff-view/stores/diff-view-store';
import { useWorkspace, useWorkspaceViewModel } from '@renderer/features/tasks/task-view-context';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { cn } from '@renderer/utils/utils';
import { GitStatusSection } from './git-status-section';
import { SECTION_HEADER_HEIGHT, usePanelLayout } from './hooks/use-panel-layout';
import { PullRequestsSection } from './pr-section';
import { StagedSection } from './staged-section';
import { UnstagedSection } from './unstaged-section';
import { Separator } from '@renderer/lib/ui/separator';

/**
 * Outer guard: mounts only when the workspace has git data. This ensures that
 * ChangesPanelContent (which owns usePanelLayout) always mounts fresh when
 * data becomes available, so its useLayoutEffect correctly syncs panel sizes
 * on first render rather than relying on a dep-array change.
 */
export const ChangesPanel = observer(function ChangesPanel() {
  const taskView = useWorkspaceViewModel();
  const workspace = useWorkspace();
  const diffView = taskView.diffView;

  if (!diffView || !workspace.git.hasData) return null;

  return <ChangesPanelContent diffView={diffView} />;
});

const ChangesPanelContent = observer(function ChangesPanelContent({
  diffView,
}: {
  diffView: DiffViewStore;
}) {
  const {
    expanded,
    toggleExpanded,
    panelTransitionClass,
    pointerHandlers,
    unstagedRef,
    stagedRef,
    prRef,
    spacerRef,
  } = usePanelLayout(diffView.changesView);

  return (
    <div className="flex h-full flex-col">


          <UnstagedSection />
          <Separator />
          <StagedSection collapsed={true} />
          <Separator />
          <PullRequestsSection
            onToggleCollapsed={() => toggleExpanded('pullRequests')}
            collapsed={true}
          />


      {/* <GitStatusSection /> */}
    </div>
  );
});
