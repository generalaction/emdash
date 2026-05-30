import { Copy, Minus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
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

export const StagedSection = observer(function StagedSection() {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const workspace = useWorkspace();
  const git = workspace.git;
  const diffView = taskView.diffView;
  const changesView = diffView?.changesView;

  const changes = git.stagedFileChanges;
  const hasChanges = changes.length > 0;

  const activePath =
    taskView.tabManager.activeDescriptor?.kind === 'diff' &&
    taskView.tabManager.activeDescriptor.diffGroup === 'staged'
      ? taskView.tabManager.activeDescriptor.path
      : undefined;

  const prefetch = usePrefetchDiffModels(projectId, workspaceId, 'staged', HEAD_REF);

  const { mode: viewMode, setMode: setViewMode } = useChangesViewMode('staged');

  if (!diffView || !changesView) return null;

  const handleSelectChange = (change: GitChange) => {
    taskView.tabManager.openDiffPreview(
      {
        path: change.path,
        type: 'git',
        group: 'staged',
        originalRef: commitRef('HEAD'),
      },
      change.status
    );
  };

  const handleDoubleClickChange = (change: GitChange) => {
    taskView.tabManager.openDiff(
      {
        path: change.path,
        type: 'git',
        group: 'staged',
        originalRef: commitRef('HEAD'),
      },
      change.status
    );
  };

  const getContextSelection = (change: GitChange) => {
    if (changesView.stagedSelection.has(change.path)) {
      return { paths: [...changesView.stagedSelection], clearSelection: true };
    }

    return { paths: [change.path], clearSelection: false };
  };

  const handleUnstagePaths = (paths: string[], clearSelection: boolean) => {
    void git.unstageFiles(paths);
    if (clearSelection) changesView.clearStagedSelection();
  };

  const handleUnstageSelection = () => {
    handleUnstagePaths([...changesView.stagedSelection], true);
  };

  const handleUnstageAll = () => {
    void git.unstageAllFiles();
  };

  return (
    <>
      <SectionHeader
        label="Staged"
        count={changes.length}
        selectionState={changesView.stagedSelectionState}
        onToggleAll={() => changesView.toggleAllStaged()}
        actions={<ChangesViewModeToggle value={viewMode} onChange={setViewMode} label="Staged" />}
        collapsed={!changesView.expandedSections.staged}
        onToggleCollapsed={() => changesView.toggleExpanded('staged')}
      />
      {!hasChanges && (
        <EmptyState
          label="Nothing staged"
          description="Stage files above to include them in a commit."
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {hasChanges && changesView.stagedSelection.size > 0 && (
          <ActionCard
            selectedCount={changesView.stagedSelection.size}
            selectionActions={
              <Button
                variant="outline"
                size="xs"
                onClick={handleUnstageSelection}
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
                disabled={!hasChanges}
                onClick={handleUnstageAll}
                title="Unstage all files"
              >
                <Minus className="size-3" />
                Unstage all
              </Button>
            }
          />
        )}
        <div className="min-h-0 flex-1 px-1">
          <ChangesListOrTree
            viewMode={viewMode}
            changes={changes}
            isSelected={(path) => changesView.stagedSelection.has(path)}
            onToggleSelect={(path) => changesView.toggleStagedItem(path)}
            activePath={activePath}
            onSelectChange={handleSelectChange}
            onDoubleClickChange={handleDoubleClickChange}
            onPrefetch={(change) => prefetch(change.path)}
            renderContextMenu={(change) => {
              const { paths, clearSelection } = getContextSelection(change);
              const isMultiple = paths.length > 1;

              return (
                <>
                  <ContextMenuItem onClick={() => handleUnstagePaths(paths, clearSelection)}>
                    <Minus className="size-4" />
                    {isMultiple ? `Unstage ${paths.length} files` : 'Unstage file'}
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
        {hasChanges && <CommitCard />}
      </div>
    </>
  );
});
