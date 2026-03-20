import { Minus, Plus, Undo2 } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
import { useTaskViewContext } from '../../task-view-context';
import { useGitChangesContext } from '../state/git-changes-provider';
import { ActiveFile, useGitViewContext } from '../state/git-view-provider';
import { PrProvider } from '../state/pr-provider';
import { useBranchStatus } from '../state/use-branch-status';
import { useSelection } from '../state/use-selection';
import { ActionCard } from './action-card';
import { CommitCard } from './commit-card';
import { GitStatusSection } from './git-status-section';
import { PullRequestSection } from './pr-section/pr-section';
import { PushCard } from './push-card';
import { SectionHeader } from './section-header';
import { usePrefetchModels } from './use-prefetch-models';
import { VirtualizedChangesList } from './virtualized-changes-list';

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
  const { setView } = useTaskViewContext();
  const prefetchDiff = usePrefetchModels(projectId, taskId);

  const { data } = useBranchStatus({ projectId, taskId });

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
        {/* Unstaged section */}
        <ResizablePanel minSize={15} defaultSize={60} className="flex flex-col overflow-hidden">
          <SectionHeader
            label="Changed"
            count={unstagedFileChanges.length}
            selectionState={unstagedSelection.selectionState}
            onToggleAll={unstagedSelection.toggleAll}
            actions={undefined}
          />
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
              activePath={activeFile?.isStaged === false ? activeFile.path : undefined}
              onSelectChange={(change) =>
                handleSelectChange({ path: change.path, isStaged: false })
              }
              onPrefetch={(change) => prefetchDiff(change.path)}
            />
          </div>
        </ResizablePanel>

        <ResizableHandle />

        <ResizablePanel minSize={15} defaultSize={40} className="flex flex-col overflow-hidden">
          <SectionHeader
            label="Staged"
            count={stagedFileChanges.length}
            selectionState={stagedSelection.selectionState}
            onToggleAll={stagedSelection.toggleAll}
            actions={undefined}
          />
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
              activePath={activeFile?.isStaged === true ? activeFile.path : undefined}
              onSelectChange={(change) => handleSelectChange({ path: change.path, isStaged: true })}
              onPrefetch={(change) => prefetchDiff(change.path)}
            />
          </div>
          {hasStaged && <CommitCard />}
          {!hasStaged && (data?.ahead ?? 0) > 0 && <PushCard />}
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel minSize={5} defaultSize={60} className="flex flex-col overflow-hidden">
          <PrProvider>
            <PullRequestSection />
          </PrProvider>
        </ResizablePanel>
        <GitStatusSection />
      </ResizablePanelGroup>
    </div>
  );
}
