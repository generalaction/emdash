import {
  ArrowDown,
  ArrowUp,
  File,
  GitBranch,
  History,
  Minus,
  Plus,
  RefreshCcw,
  Undo2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { Input } from '@renderer/components/ui/input';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
import { Textarea } from '@renderer/components/ui/textarea';
import { cn } from '@renderer/lib/utils';
import { useTaskViewContext } from '../../task-view-context';
import { useGitChangesContext } from '../git-changes-provider';
import { useGitViewContext } from '../git-view-provider';
import { useBranchStatus } from '../use-branch-status.tsx';
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

function CommitCard() {
  const [commitMessage, setCommitMessage] = useState('');
  const [description, setDescription] = useState('');
  const { commitChanges } = useGitChangesContext();
  return (
    <div className="shrink-0 mx-2 mb-2 flex flex-col gap-1 items-center justify-between rounded-lg border border-border  p-2.5">
      <Input
        placeholder="Commit message"
        className="w-full"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
      />
      <Textarea
        placeholder="Description"
        className="w-full"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Button
        variant="default"
        size="sm"
        className="w-full"
        onClick={() => commitChanges(commitMessage + '\n\n' + description)}
      >
        Commit
      </Button>
    </div>
  );
}

function SectionHeader({ label, count, selectionState, onToggleAll, actions }: SectionHeaderProps) {
  return (
    <div className="shrink-0 flex items-center justify-between px-2.5 py-2 ">
      <div className="flex items-center gap-2 justify-between w-full">
        <span className="text-sm text-muted-foreground flex items-center gap-2">
          {label} <Badge variant="secondary">{count}</Badge>
        </span>
        <Checkbox
          checked={selectionState === 'all'}
          indeterminate={selectionState === 'partial'}
          onCheckedChange={onToggleAll}
          aria-label={`Select all ${label.toLowerCase()}`}
          className="mr-0.5"
        />
      </div>
      {actions}
    </div>
  );
}

function GitStatusSection() {
  const { projectId, taskId } = useTaskViewContext();
  const { data, fetchChanges, pullChanges, pushChanges } = useBranchStatus({ projectId, taskId });
  return (
    <div className="p-2 border-t border-border flex flex-col gap-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <GitBranch className="size-3" />
        <span className="text-sm text-muted-foreground">{data?.branch}</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" className="flex-1" size="xs" onClick={() => fetchChanges()}>
          <RefreshCcw className="size-3" />
          Fetch
        </Button>
        <Button variant="outline" className="flex-1" size="xs" onClick={() => pullChanges()}>
          <ArrowDown className="size-3" />
          Pull
          <Badge variant="secondary">{data?.behind ?? 0}</Badge>
        </Button>
        <Button variant="outline" className="flex-1" size="xs" onClick={() => pushChanges()}>
          <ArrowUp className="size-3" />
          Push
          <Badge variant="secondary">{data?.ahead ?? 0}</Badge>
        </Button>
      </div>
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

  return (
    <div className="flex h-full flex-col">
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
                  onClick={() => void handleUnstageSelection()}
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
                  onClick={() => void unstageAllChanges()}
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
            />
          </div>
          {hasStaged && <CommitCard />}
        </ResizablePanel>
        <GitStatusSection />
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
