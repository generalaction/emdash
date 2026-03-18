import { File, History, Minus, Plus, Undo2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
import { cn } from '@renderer/lib/utils';
import { useGitChangesContext } from '../git-changes-provider';
import { useGitViewContext } from '../git-view-provider';
import { useSelection, type SelectionState } from '../use-selection';
import { VirtualizedChangesList } from './virtualized-changes-list';

interface SectionHeaderProps {
  label: string;
  count: number;
  selectionState: SelectionState;
  onToggleAll: () => void;
  actions?: React.ReactNode;
}

interface ActionCardProps {
  selectedCount: number;
  selectionActions: ReactNode;
  generalActions: ReactNode;
}

function ActionCard({ selectedCount, selectionActions, generalActions }: ActionCardProps) {
  const hasSelection = selectedCount > 0;
  return (
    <div className="shrink-0 mx-2 mb-2 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
      <span className="text-xs text-muted-foreground">
        {hasSelection
          ? `${selectedCount} file${selectedCount !== 1 ? 's' : ''} selected`
          : 'All files'}
      </span>
      <div className="flex items-center gap-1.5">
        {hasSelection ? selectionActions : generalActions}
      </div>
    </div>
  );
}

function SectionHeader({ label, count, selectionState, onToggleAll, actions }: SectionHeaderProps) {
  return (
    <div className="shrink-0 flex items-center justify-between px-2.5 py-2 border-b border-border">
      <div className="flex items-center gap-2">
        <Checkbox
          checked={selectionState === 'all'}
          indeterminate={selectionState === 'partial'}
          onCheckedChange={onToggleAll}
          aria-label={`Select all ${label.toLowerCase()}`}
        />
        <span className="text-sm font-medium">
          {label} ({count})
        </span>
      </div>
      {actions}
    </div>
  );
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

  const unstagedSelection = useSelection(unstagedFileChanges);
  const stagedSelection = useSelection(stagedFileChanges);

  const hasUnstaged = unstagedFileChanges.length > 0;
  const hasStaged = stagedFileChanges.length > 0;

  const handleDiscardSelection = () => discardFilesChanges([...unstagedSelection.selectedPaths]);
  const handleStageSelection = () => stageFilesChanges([...unstagedSelection.selectedPaths]);
  const handleUnstageSelection = () => unstageFilesChanges([...stagedSelection.selectedPaths]);

  return (
    <div className="flex h-full flex-col">
      <ChangesPanelHeader />

      <ResizablePanelGroup direction="vertical" className="min-h-0 flex-1">
        {/* Unstaged section */}
        <ResizablePanel minSize={15} defaultSize={60} className="flex flex-col overflow-hidden">
          <SectionHeader
            label="Changes"
            count={unstagedFileChanges.length}
            selectionState={unstagedSelection.selectionState}
            onToggleAll={unstagedSelection.toggleAll}
            actions={undefined}
          />
          <div className="min-h-0 flex-1 p-1">
            <VirtualizedChangesList
              changes={unstagedFileChanges}
              isSelected={unstagedSelection.isSelected}
              onToggleSelect={unstagedSelection.toggleItem}
            />
          </div>
          <ActionCard
            selectedCount={unstagedSelection.selectedPaths.size}
            selectionActions={
              <>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => void handleDiscardSelection()}
                  title="Discard selected files"
                >
                  <Undo2 className="size-3" />
                  Discard
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => void handleStageSelection()}
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
                  variant="outline"
                  size="xs"
                  disabled={!hasUnstaged}
                  onClick={() => void discardAllChanges()}
                  title="Discard all changes"
                >
                  <Undo2 className="size-3" />
                  Discard all
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!hasUnstaged}
                  onClick={() => void stageAllChanges()}
                  title="Stage all changes"
                >
                  <Plus className="size-3" />
                  Stage all
                </Button>
              </>
            }
          />
        </ResizablePanel>

        <ResizableHandle />

        {/* Staged section */}
        <ResizablePanel minSize={15} defaultSize={40} className="flex flex-col overflow-hidden">
          <SectionHeader
            label="Staged"
            count={stagedFileChanges.length}
            selectionState={stagedSelection.selectionState}
            onToggleAll={stagedSelection.toggleAll}
            actions={undefined}
          />
          <div className="min-h-0 flex-1 p-1">
            <VirtualizedChangesList
              changes={stagedFileChanges}
              isSelected={stagedSelection.isSelected}
              onToggleSelect={stagedSelection.toggleItem}
            />
          </div>
          <ActionCard
            selectedCount={stagedSelection.selectedPaths.size}
            selectionActions={
              <Button
                variant="outline"
                size="xs"
                onClick={() => void handleUnstageSelection()}
                title="Unstage selected files"
              >
                <Minus className="size-3" />
                Unstage
              </Button>
            }
            generalActions={
              <Button
                variant="outline"
                size="xs"
                disabled={!hasStaged}
                onClick={() => void unstageAllChanges()}
                title="Unstage all files"
              >
                <Minus className="size-3" />
                Unstage all
              </Button>
            }
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}

export function ChangesPanelHeader() {
  const { activeTab, setActiveTab } = useGitViewContext();
  const { totalFilesChanged, totalLinesAdded, totalLinesDeleted } = useGitChangesContext();
  return (
    <div className="flex gap-2 p-2">
      <button
        onClick={() => setActiveTab('changes')}
        className={cn(
          'flex-1 text-center text-xs transition-colors rounded-lg border border-border h-7 flex items-center justify-center gap-2',
          activeTab === 'changes'
            ? 'text-foreground bg-muted'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <span className="flex items-center justify-center gap-0.5 text-muted-foreground">
          <File className="size-3" />
          {totalFilesChanged}
        </span>
        {totalLinesAdded > 0 && (
          <span className="flex items-center justify-center gap-0.5 text-green-600">
            <Plus className="size-3" />
            {totalLinesAdded}
          </span>
        )}
        {totalLinesDeleted > 0 && (
          <span className="flex items-center justify-center gap-0.5 text-red-600">
            <Minus className="size-3" />
            {totalLinesDeleted}
          </span>
        )}
      </button>
      <button
        onClick={() => setActiveTab('history')}
        className={cn(
          'text-center text-xs transition-colors rounded-lg border border-border size-7 flex items-center justify-center',
          activeTab === 'history'
            ? 'text-foreground bg-muted'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <History className="size-3.5" />
      </button>
    </div>
  );
}
