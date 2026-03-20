import { Minus, Plus, Undo2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { Button } from '@renderer/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
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

type ExpandedState = {
  unstaged: boolean;
  staged: boolean;
  pullRequests: boolean;
};

export function useExpandedState() {
  const unstagedRef = useRef<ImperativePanelHandle>(null);
  const stagedRef = useRef<ImperativePanelHandle>(null);
  const prRef = useRef<ImperativePanelHandle>(null);

  const [expanded, setExpanded] = useState<ExpandedState>({
    unstaged: true,
    staged: false,
    pullRequests: false,
  });

  const toggleExpanded = (section: keyof ExpandedState) => {
    const ref = section === 'unstaged' ? unstagedRef : section === 'staged' ? stagedRef : prRef;
    if (ref.current?.isCollapsed()) {
      ref.current.expand();
    } else {
      ref.current?.collapse();
    }
  };

  return { unstagedRef, stagedRef, prRef, expanded, setExpanded, toggleExpanded };
}

export function ChangesPanel() {
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
  const { unstagedRef, stagedRef, prRef, expanded, setExpanded, toggleExpanded } =
    useExpandedState();
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

  return (
    <div className="flex h-full flex-col">
      <ResizablePanelGroup direction="vertical" className="min-h-0 flex-1">
        <SectionHeader
          label="Changed"
          collapsed={!expanded.unstaged}
          onToggleCollapsed={() => toggleExpanded('unstaged')}
          count={unstagedFileChanges.length}
          selectionState={unstagedSelection.selectionState}
          onToggleAll={unstagedSelection.toggleAll}
          actions={undefined}
        />
        <ResizablePanel
          ref={unstagedRef}
          minSize={15}
          defaultSize={60}
          className="flex flex-col overflow-hidden"
          collapsible
        >
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
        </ResizablePanel>

        <ResizableHandle />

        <SectionHeader
          label="Staged"
          count={stagedFileChanges.length}
          selectionState={stagedSelection.selectionState}
          onToggleAll={stagedSelection.toggleAll}
          actions={undefined}
          collapsed={!expanded.staged}
          onToggleCollapsed={() => toggleExpanded('staged')}
        />
        <ResizablePanel
          ref={stagedRef}
          minSize={15}
          defaultSize={40}
          onCollapse={() => setExpanded((prev) => ({ ...prev, staged: false }))}
          onExpand={() => setExpanded((prev) => ({ ...prev, staged: true }))}
          className="flex flex-col overflow-hidden"
          collapsible
        >
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
        </ResizablePanel>
        <ResizableHandle />
        <PullRequestSectionHeader
          count={pullRequests.length}
          collapsed={!expanded.pullRequests}
          onToggleCollapsed={() => toggleExpanded('pullRequests')}
        />
        <ResizablePanel
          ref={prRef}
          minSize={5}
          defaultSize={60}
          onCollapse={() => setExpanded((prev) => ({ ...prev, pullRequests: false }))}
          onExpand={() => setExpanded((prev) => ({ ...prev, pullRequests: true }))}
          className="flex flex-col overflow-hidden"
          collapsible
        >
          {pullRequests.length === 0 && <CreatePullRequestCard />}
          {pullRequests.map((pr) => (
            <PullRequestEntry key={pr.id} pr={pr} />
          ))}
        </ResizablePanel>
        <GitStatusSection />
      </ResizablePanelGroup>
    </div>
  );
}
