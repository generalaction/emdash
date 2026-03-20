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
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { isBinaryForDiff } from '@renderer/lib/fileKind';
import { getLanguageFromPath } from '@renderer/lib/languageUtils';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';
import { cn } from '@renderer/lib/utils';
import { useTaskViewContext } from '../../task-view-context';
import { useGitChangesContext } from '../state/git-changes-provider';
import { ActiveFile, useGitViewContext } from '../state/git-view-provider';
import { PrProvider } from '../state/pr-provider';
import { useBranchStatus } from '../state/use-branch-status';
import { useSelection, type SelectionState } from '../state/use-selection';
import { PullRequestSection } from './pr-section/pr-section';
import { VirtualizedChangesList } from './virtualized-changes-list';

/**
 * Returns a stable callback that pre-warms Monaco models on hover so that when the user
 * clicks to open a diff the models are already loaded. Models are unregistered on unmount.
 * TTL eviction (60 s after last subscriber leaves) handles any remaining cleanup.
 */
function usePrefetchModels(projectId: string, taskId: string) {
  const prefetchedRef = useRef(new Set<string>());

  useEffect(() => {
    const prefetched = prefetchedRef.current;
    return () => {
      for (const filePath of prefetched) {
        const uri = buildMonacoModelPath(`task:${taskId}`, filePath);
        modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
        modelRegistry.unregisterModel(modelRegistry.toGitUri(uri, 'HEAD'));
      }
    };
  }, [taskId]);

  return useCallback(
    (filePath: string) => {
      if (prefetchedRef.current.has(filePath)) return;
      if (isBinaryForDiff(filePath)) return;
      prefetchedRef.current.add(filePath);
      const language = getLanguageFromPath(filePath);
      void modelRegistry
        .registerModel(projectId, taskId, `task:${taskId}`, filePath, language, 'disk')
        .catch(() => {});
      void modelRegistry
        .registerModel(projectId, taskId, `task:${taskId}`, filePath, language, 'git')
        .catch(() => {});
    },
    [projectId, taskId]
  );
}

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
    <div className="shrink-0 mx-2 mb-2 flex flex-col gap-2 items-center justify-between rounded-lg border border-border  p-2.5">
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

function PushCard() {
  const { projectId, taskId } = useTaskViewContext();
  const { pushChanges, data } = useBranchStatus({ projectId, taskId });

  return (
    <div className="shrink-0 mx-2 mb-2 flex flex-col gap-2 items-center justify-between rounded-lg border border-border  p-2.5">
      <Button variant="default" size="sm" className="w-full" onClick={() => pushChanges()}>
        <ArrowUp className="size-3" />
        Push changes
        <Badge variant="secondary">{data?.ahead ?? 0}</Badge>
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
  const hasMatchingUpstream = !!data?.upstream && data.upstream.endsWith(`/${data.branch}`);
  const isUnpublished = data !== undefined && !hasMatchingUpstream;
  return (
    <div className="p-2 border-t border-border flex flex-col gap-2">
      <div className="flex items-center gap-2 text-muted-foreground justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="size-3" />
          <span className="text-sm text-muted-foreground">{data?.branch}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-xs" onClick={() => fetchChanges()}>
            <RefreshCcw className="size-3" />
          </Button>
          <Button variant="outline" size="icon-xs" onClick={() => pullChanges()}>
            <ArrowDown className="size-3" />
          </Button>
          <Button
            variant="outline"
            size={isUnpublished ? 'xs' : 'icon-xs'}
            onClick={() => pushChanges()}
          >
            <ArrowUp className="size-3" />
            {isUnpublished && 'Publish & push'}
          </Button>
        </div>
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
