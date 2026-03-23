import { Minus, Plus, Undo2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
import { cn } from '@renderer/lib/utils';
import { useGitChangesContext } from '@renderer/views/tasks/diff-viewer/state/git-changes-provider';
import { useGitViewContext } from '@renderer/views/tasks/diff-viewer/state/git-view-provider';
import { usePrContext } from '@renderer/views/tasks/diff-viewer/state/pr-provider';
import { useBranchStatus } from '@renderer/views/tasks/diff-viewer/state/use-branch-status';
import { useSelection } from '@renderer/views/tasks/diff-viewer/state/use-selection';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';
import { ActionCard } from './action-card';
import { CommitCard } from './commit-card';
import { GitStatusSection } from './git-status-section';
import { PullRequestEntry } from './pr-section/pr-section';
import { PushCard } from './push-card';
import { PullRequestSectionHeader, SectionHeader } from './section-header';
import { SECTION_HEADER_HEIGHT, usePanelLayout } from './use-panel-layout';
import { usePrefetchModels } from './use-prefetch-models';
import { VirtualizedChangesList } from './virtualized-changes-list';

export function ChangesPanel() {
  const {
    expanded,
    toggleExpanded,
    setExpanded,
    panelTransitionClass,
    pointerHandlers,
    unstagedRef,
    stagedRef,
    prRef,
    spacerRef,
  } = usePanelLayout();

  const {
    stagedFileChanges,
    unstagedFileChanges,
    stageAllChanges,
    unstageAllChanges,
    discardAllChanges,
    stageFilesChanges,
    unstageFilesChanges,
    discardFilesChanges,
    commitChanges,
  } = useGitChangesContext();
  const { projectId, taskId, view, setView } = useTaskViewContext();
  const { activeFile, setActiveFile } = useGitViewContext();
  const prefetchUnstagedDiff = usePrefetchModels(projectId, taskId, 'disk', 'HEAD');
  const prefetchStagedDiff = usePrefetchModels(projectId, taskId, 'staged', 'HEAD');

  const { data } = useBranchStatus({ projectId, taskId });

  const { pullRequests } = usePrContext();

  const unstagedSelection = useSelection(unstagedFileChanges);
  const stagedSelection = useSelection(stagedFileChanges);

  const hasUnstaged = unstagedFileChanges.length > 0;
  const hasStaged = stagedFileChanges.length > 0;
  const hasPRs = pullRequests.length > 0;

  // Fire once when data first arrives to set a sensible initial layout.
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    setExpanded({
      unstaged: hasUnstaged || (!hasStaged && !hasPRs),
      staged: hasStaged,
      pullRequests: hasPRs && !hasStaged,
    });
  }, [hasUnstaged, hasStaged, hasPRs, setExpanded]);

  // Expand the panel containing the active file whenever the user selects one.
  useEffect(() => {
    if (!activeFile) return;
    setExpanded((prev) => ({
      ...prev,
      [activeFile.type === 'disk' ? 'unstaged' : 'staged']: true,
    }));
  }, [activeFile, setExpanded]);

  const handleDiscardSelection = () => {
    const remaining = unstagedFileChanges.length - unstagedSelection.selectedPaths.size;
    discardFilesChanges([...unstagedSelection.selectedPaths]);
    unstagedSelection.clear();
    setExpanded((prev) => ({ ...prev, unstaged: remaining > 0 }));
  };
  const handleDiscardAll = () => {
    discardAllChanges();
    setExpanded((prev) => ({ ...prev, unstaged: false }));
  };
  const handleStageSelection = () => {
    const remaining = unstagedFileChanges.length - unstagedSelection.selectedPaths.size;
    stageFilesChanges([...unstagedSelection.selectedPaths]);
    unstagedSelection.clear();
    setExpanded({ unstaged: remaining > 0, staged: true, pullRequests: false });
  };
  const handleStageAll = () => {
    stageAllChanges();
    setExpanded({ unstaged: false, staged: true, pullRequests: false });
  };
  const handleUnstageSelection = () => {
    const remaining = stagedFileChanges.length - stagedSelection.selectedPaths.size;
    unstageFilesChanges([...stagedSelection.selectedPaths]);
    stagedSelection.clear();
    setExpanded({ unstaged: true, staged: remaining > 0, pullRequests: hasPRs });
  };
  const handleUnstageAll = () => {
    unstageAllChanges();
    setExpanded({ unstaged: true, staged: false, pullRequests: hasPRs });
  };
  const handleCommit = (message: string) => {
    commitChanges(message);
    setExpanded({ unstaged: true, staged: false, pullRequests: hasPRs });
  };

  const handleSelectChange = (path: string, type: 'disk' | 'staged') => {
    setActiveFile({ path, type, originalRef: 'HEAD' });
    setView('diff');
  };

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
          <SectionHeader
            label="Changed"
            collapsed={!expanded.unstaged}
            onToggleCollapsed={() => toggleExpanded('unstaged')}
            count={unstagedFileChanges.length}
            selectionState={unstagedSelection.selectionState}
            onToggleAll={unstagedSelection.toggleAll}
            actions={undefined}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {!hasUnstaged && <ChangedEmptyState />}
            {hasUnstaged && (
              <ActionCard
                selectedCount={unstagedSelection.selectedPaths.size}
                selectionActions={
                  <>
                    <Button
                      variant="link"
                      size="xs"
                      onClick={() => handleDiscardSelection()}
                      title="Discard selected files"
                    >
                      <Undo2 className="size-3" />
                      Discard
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => handleStageSelection()}
                      title="Stage selected files"
                    >
                      <Plus className="size-3" />
                      Stage
                    </Button>
                  </>
                }
                generalActions={
                  <>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={!hasUnstaged}
                      onClick={handleDiscardAll}
                      title="Discard all changes"
                    >
                      <Undo2 className="size-3" />
                      Discard all
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={!hasUnstaged}
                      onClick={handleStageAll}
                      title="Stage all changes"
                    >
                      <Plus className="size-3" />
                      Stage all
                    </Button>
                  </>
                }
              />
            )}
            <div className="min-h-0 flex-1 p-1">
              <VirtualizedChangesList
                changes={unstagedFileChanges}
                isSelected={unstagedSelection.isSelected}
                onToggleSelect={unstagedSelection.toggleItem}
                activePath={
                  view === 'diff' && activeFile?.type === 'disk' ? activeFile.path : undefined
                }
                onSelectChange={(change) => handleSelectChange(change.path, 'disk')}
                onPrefetch={(change) => prefetchUnstagedDiff(change.path)}
              />
            </div>
          </div>
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
          <SectionHeader
            label="Staged"
            count={stagedFileChanges.length}
            selectionState={stagedSelection.selectionState}
            onToggleAll={stagedSelection.toggleAll}
            actions={undefined}
            collapsed={!expanded.staged}
            onToggleCollapsed={() => toggleExpanded('staged')}
          />
          {!hasStaged && <StagedEmptyState />}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {hasStaged && stagedSelection.selectedPaths.size > 0 && (
              <ActionCard
                selectedCount={stagedSelection.selectedPaths.size}
                selectionActions={
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => handleUnstageSelection()}
                    title="Unstage selected files"
                  >
                    <Minus className="size-3" />
                    Unstage
                  </Button>
                }
                generalActions={
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={!hasStaged}
                    onClick={handleUnstageAll}
                    title="Unstage all files"
                  >
                    <Minus className="size-3" />
                    Unstage all
                  </Button>
                }
              />
            )}
            <div className="min-h-0 flex-1 p-1">
              <VirtualizedChangesList
                changes={stagedFileChanges}
                isSelected={stagedSelection.isSelected}
                onToggleSelect={stagedSelection.toggleItem}
                activePath={
                  view === 'diff' && activeFile?.type === 'staged' ? activeFile.path : undefined
                }
                onSelectChange={(change) => handleSelectChange(change.path, 'staged')}
                onPrefetch={(change) => prefetchStagedDiff(change.path)}
              />
            </div>
            {hasStaged && <CommitCard onCommit={handleCommit} />}
            {!hasStaged && (data?.ahead ?? 0) > 0 && <PushCard />}
          </div>
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
          <PullRequestSectionHeader
            count={pullRequests.length}
            collapsed={!expanded.pullRequests}
            onToggleCollapsed={() => toggleExpanded('pullRequests')}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {pullRequests.length === 0 && <PullRequestEmptyState />}
            {pullRequests.map((pr) => (
              <PullRequestEntry key={pr.id} pr={pr} />
            ))}
          </div>
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
}

export function ChangedEmptyState() {
  return <EmptyState label="Working tree clean" description="No uncommitted file changes." />;
}

export function StagedEmptyState() {
  return (
    <EmptyState
      label="Nothing staged"
      description="Stage files above to include them in a commit."
    />
  );
}

export function PullRequestEmptyState() {
  return (
    <EmptyState
      label="No pull requests"
      description="Push your branch and create a PR to start a review."
    />
  );
}
