import { Minus, Plus, Undo2 } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import { Button } from '@renderer/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
import { cn } from '@renderer/lib/utils';
import { useTaskViewContext } from '../../task-view-context';
import { useGitChangesContext } from '../state/git-changes-provider';
import { ActiveFile, useGitViewContext } from '../state/git-view-provider';
import { usePrContext } from '../state/pr-provider';
import { useBranchStatus } from '../state/use-branch-status';
import { useSelection } from '../state/use-selection';
import { ActionCard } from './action-card';
import { CommitCard } from './commit-card';
import { GitStatusSection } from './git-status-section';
import { CreatePullRequestCard, PullRequestEntry } from './pr-section/pr-section';
import { PushCard } from './push-card';
import { PullRequestSectionHeader, SectionHeader } from './section-header';
import { usePrefetchModels } from './use-prefetch-models';
import { VirtualizedChangesList } from './virtualized-changes-list';

// Matches the SectionHeader height: outer py-2 (8+8px) + button p-2 (8+8px) + size-4 icon (16px) = 48px
const SECTION_HEADER_HEIGHT = '3rem';

type ExpandedState = {
  unstaged: boolean;
  staged: boolean;
  pullRequests: boolean;
};

export function ChangesPanel() {
  const unstagedRef = usePanelRef();
  const stagedRef = usePanelRef();
  const prRef = usePanelRef();
  const spacerRef = usePanelRef();

  const [expanded, setExpanded] = useState<ExpandedState>({
    unstaged: true,
    staged: true,
    pullRequests: true,
  });
  const [isDragging, setIsDragging] = useState(false);

  const toggleExpanded = (section: keyof ExpandedState) =>
    setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));

  // Synchronously resize all panels before paint so there is no visible flicker
  // when toggling sections. Collapsed panels are pinned to header height;
  // expanded panels share the remaining space equally.
  useLayoutEffect(() => {
    const sections = [
      { key: 'unstaged' as const, ref: unstagedRef },
      { key: 'staged' as const, ref: stagedRef },
      { key: 'pullRequests' as const, ref: prRef },
    ];

    const expandedCount = sections.filter((s) => expanded[s.key]).length;
    const share = expandedCount > 0 ? `${100 / expandedCount}%` : '0%';

    // Shrink the spacer first so the content panels have room to grow into.
    // If all sections are collapsed the spacer fills whatever remains instead.
    spacerRef.current?.resize(expandedCount === 0 ? '100%' : '0%');

    sections.forEach(({ key, ref }) =>
      ref.current?.resize(expanded[key] ? share : SECTION_HEADER_HEIGHT)
    );
  }, [expanded, unstagedRef, stagedRef, prRef, spacerRef]);

  const {
    stagedFileChanges,
    unstagedFileChanges,
    stageAllChanges,
    unstageAllChanges,
    discardAllChanges,
    stageFilesChanges,
    unstageFilesChanges,
    discardFilesChanges,
  } = useGitChangesContext();
  const { projectId, taskId } = useTaskViewContext();
  const { activeFile, setActiveFile } = useGitViewContext();
  const { setView } = useTaskViewContext();
  const prefetchDiff = usePrefetchModels(projectId, taskId);

  const { data } = useBranchStatus({ projectId, taskId });

  const { pullRequests } = usePrContext();

  const unstagedSelection = useSelection(unstagedFileChanges);
  const stagedSelection = useSelection(stagedFileChanges);

  const hasUnstaged = unstagedFileChanges.length > 0;
  const hasStaged = stagedFileChanges.length > 0;

  const handleDiscardSelection = () => {
    discardFilesChanges([...unstagedSelection.selectedPaths]);
    unstagedSelection.clear();
  };
  const handleStageSelection = () => {
    stageFilesChanges([...unstagedSelection.selectedPaths]);
    unstagedSelection.clear();
  };
  const handleUnstageSelection = () => {
    unstageFilesChanges([...stagedSelection.selectedPaths]);
    stagedSelection.clear();
  };

  const handleSelectChange = (file: ActiveFile | null) => {
    setActiveFile(file);
    if (file) {
      setView('diff');
    }
  };

  const panelTransitionClass = !isDragging && '[transition:flex-basis_200ms_ease-in-out]';
  const pointerHandlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsDragging(true);
    },
    onPointerUp: () => setIsDragging(false),
    onPointerCancel: () => setIsDragging(false),
  };

  return (
    <div className="flex h-full flex-col">
      <ResizablePanelGroup
        orientation="vertical"
        className="min-h-0 flex-1"
        id="changes-panel-group"
      >
        {/* ── Unstaged ─────────────────────────────────────────── */}
        <ResizablePanel
          id="changes-unstaged"
          panelRef={unstagedRef}
          minSize={SECTION_HEADER_HEIGHT}
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
          {expanded.unstaged && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
                        onClick={() => discardAllChanges()}
                        title="Discard all changes"
                      >
                        <Undo2 className="size-3" />
                        Discard all
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={!hasUnstaged}
                        onClick={() => stageAllChanges()}
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
                  activePath={activeFile?.stage === 'unstaged' ? activeFile.path : undefined}
                  onSelectChange={(change) =>
                    handleSelectChange({ path: change.path, stage: 'unstaged' })
                  }
                  onPrefetch={(change) => prefetchDiff(change.path)}
                />
              </div>
            </div>
          )}
        </ResizablePanel>

        <ResizableHandle disabled={!expanded.unstaged || !expanded.staged} {...pointerHandlers} />

        {/* ── Staged ───────────────────────────────────────────── */}
        <ResizablePanel
          id="changes-staged"
          panelRef={stagedRef}
          minSize={SECTION_HEADER_HEIGHT}
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
          {expanded.staged && (
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
                      onClick={() => unstageAllChanges()}
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
                  activePath={activeFile?.stage === 'staged' ? activeFile.path : undefined}
                  onSelectChange={(change) =>
                    handleSelectChange({ path: change.path, stage: 'staged' })
                  }
                  onPrefetch={(change) => prefetchDiff(change.path)}
                />
              </div>
              {hasStaged && <CommitCard />}
              {!hasStaged && (data?.ahead ?? 0) > 0 && <PushCard />}
            </div>
          )}
        </ResizablePanel>

        <ResizableHandle
          disabled={!expanded.staged || !expanded.pullRequests}
          {...pointerHandlers}
        />

        {/* ── Pull Requests ─────────────────────────────────────── */}
        <ResizablePanel
          id="changes-pr"
          panelRef={prRef}
          minSize={SECTION_HEADER_HEIGHT}
          maxSize="100%"
          defaultSize="33%"
          className={cn('flex flex-col overflow-hidden', panelTransitionClass)}
        >
          <PullRequestSectionHeader
            count={pullRequests.length}
            collapsed={!expanded.pullRequests}
            onToggleCollapsed={() => toggleExpanded('pullRequests')}
          />
          {expanded.pullRequests && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {pullRequests.length === 0 && <CreatePullRequestCard />}
              {pullRequests.map((pr) => (
                <PullRequestEntry key={pr.id} pr={pr} />
              ))}
            </div>
          )}
        </ResizablePanel>

        {/* ── Spacer ────────────────────────────────────────────── */}
        {/* Absorbs remaining space when all sections are collapsed.  */}
        {/* No separator above it so users cannot drag it directly.   */}
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
