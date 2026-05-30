import { Copy, Plus, Undo2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ContextMenuItem, ContextMenuSeparator } from '@renderer/lib/ui/context-menu';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { commitRef, type GitChange, HEAD_REF } from '@shared/git';
import { ActionCard } from './components/action-card';
import { ChangesListOrTree } from './components/changes-list-or-tree';
import { ChangesViewModeToggle } from './components/changes-view-mode-toggle';
import { CommitCard } from './components/commit-card';
import { SectionHeader } from './components/section-header';
import { copyRelativePaths } from './git-clipboard-utils';
import { useChangesViewMode } from './hooks/use-changes-view-mode';
import { usePrefetchDiffModels } from './hooks/use-prefetch-diff-models';

export const UnstagedSection = observer(function UnstagedSection() {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const workspace = useWorkspace();
  const git = workspace.git;
  const diffView = taskView.diffView;
  const changesView = diffView?.changesView;

  const changes = git.unstagedFileChanges;
  const hasChanges = changes.length > 0;
  const hasStagedChanges = git.stagedFileChanges.length > 0;

  const activePath =
    taskView.tabManager.activeDescriptor?.kind === 'diff' &&
    taskView.tabManager.activeDescriptor.diffGroup === 'disk'
      ? taskView.tabManager.activeDescriptor.path
      : undefined;

  const prefetch = usePrefetchDiffModels(projectId, workspaceId, 'disk', HEAD_REF);

  const { mode: viewMode, setMode: setViewMode } = useChangesViewMode('unstaged');

  const showConfirmActionModal = useShowModal('confirmActionModal');

  if (!diffView || !changesView) return null;

  const handleSelectChange = (change: GitChange) => {
    taskView.tabManager.openDiffPreview(
      {
        path: change.path,
        type: 'disk',
        group: 'disk',
        originalRef: commitRef('HEAD'),
      },
      change.status
    );
  };

  const handleDoubleClickChange = (change: GitChange) => {
    taskView.tabManager.openDiff(
      {
        path: change.path,
        type: 'disk',
        group: 'disk',
        originalRef: commitRef('HEAD'),
      },
      change.status
    );
  };

  const getContextSelection = (change: GitChange) => {
    if (changesView.unstagedSelection.has(change.path)) {
      return { paths: [...changesView.unstagedSelection], clearSelection: true };
    }

    return { paths: [change.path], clearSelection: false };
  };

  const handleDiscardPaths = (paths: string[], clearSelection: boolean) => {
    const isMultiple = paths.length > 1;
    showConfirmActionModal({
      title: isMultiple ? 'Discard Selected Changes' : 'Discard Changes',
      variant: 'destructive',
      description: isMultiple
        ? 'Are you sure you want to discard the changes to the selected files? This cannot be undone.'
        : 'Are you sure you want to discard the changes to this file? This cannot be undone.',
      onSuccess: () => {
        void (async () => {
          await git.discardFiles(paths);
          if (clearSelection) changesView.clearUnstagedSelection();
        })();
      },
    });
  };

  const handleDiscardSelection = () => {
    handleDiscardPaths([...changesView.unstagedSelection], true);
  };

  const handleDiscardAll = () => {
    showConfirmActionModal({
      title: 'Discard All Changes',
      variant: 'destructive',
      description: 'Are you sure you want to discard all changes? This can not be undone.',
      onSuccess: () => void git.discardAllFiles(),
    });
  };

  const handleStagePaths = (paths: string[], clearSelection: boolean) => {
    void git.stageFiles(paths);
    if (clearSelection) changesView.clearUnstagedSelection();
  };

  const handleStageSelection = () => {
    handleStagePaths([...changesView.unstagedSelection], true);
  };

  const handleStageAll = () => {
    void git.stageAllFiles();
  };

  return (
    <>
      <SectionHeader
        label="Changed"
        collapsed={!changesView.expandedSections.unstaged}
        onToggleCollapsed={() => changesView.toggleExpanded('unstaged')}
        count={changes.length}
        selectionState={changesView.unstagedSelectionState}
        onToggleAll={() => changesView.toggleAllUnstaged()}
        actions={<ChangesViewModeToggle value={viewMode} onChange={setViewMode} label="Changed" />}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!hasChanges && (
          <EmptyState label="Working tree clean" description="No uncommitted file changes." />
        )}
        {hasChanges && (
          <ActionCard
            selectedCount={changesView.unstagedSelection.size}
            selectionActions={
              <>
                <Button
                  variant="link"
                  size="xs"
                  onClick={handleDiscardSelection}
                  title="Discard selected files"
                  className="text-foreground-destructive"
                >
                  <Undo2 className="size-3" />
                  Discard
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={handleStageSelection}
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
                  variant="link"
                  size="xs"
                  disabled={!hasChanges}
                  onClick={handleDiscardAll}
                  title="Discard all changes"
                  className="text-foreground-destructive"
                >
                  <Undo2 className="size-3" />
                  Discard all
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  disabled={!hasChanges}
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
        <div className="min-h-0 flex-1 px-1">
          <ChangesListOrTree
            viewMode={viewMode}
            changes={changes}
            isSelected={(path) => changesView.unstagedSelection.has(path)}
            onToggleSelect={(path) => changesView.toggleUnstagedItem(path)}
            activePath={activePath}
            onSelectChange={handleSelectChange}
            onDoubleClickChange={handleDoubleClickChange}
            onPrefetch={(change) => prefetch(change.path)}
            renderContextMenu={(change) => {
              const { paths, clearSelection } = getContextSelection(change);
              const isMultiple = paths.length > 1;

              return (
                <>
                  <ContextMenuItem onClick={() => handleStagePaths(paths, clearSelection)}>
                    <Plus className="size-4" />
                    {isMultiple ? `Stage ${paths.length} files` : 'Stage file'}
                  </ContextMenuItem>
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => handleDiscardPaths(paths, clearSelection)}
                  >
                    <Undo2 className="size-4" />
                    {isMultiple ? `Discard ${paths.length} files` : 'Discard changes'}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => void copyRelativePaths(paths)}>
                    <Copy className="size-4" />
                    {isMultiple ? 'Copy relative paths' : 'Copy relative path'}
                  </ContextMenuItem>
                </>
              );
            }}
          />
        </div>
        {hasChanges && !hasStagedChanges && <CommitCard autoStage />}
      </div>
    </>
  );
});
