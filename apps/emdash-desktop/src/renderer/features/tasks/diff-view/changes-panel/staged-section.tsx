import type { GitChange } from '@emdash/shared/git';
import { Minus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { toast } from 'sonner';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { commitRef, HEAD_REF } from '@shared/core/git/git';
import { formatErrorType } from '../../utils';
import { ActionCard } from './components/action-card';
import { ChangesListOrTree } from './components/changes-list-or-tree';
import { ChangesViewModeToggle } from './components/changes-view-mode-toggle';
import { CommitCard } from './components/commit-card';
import { SectionHeader } from './components/section-header';
import { useChangesViewMode } from './hooks/use-changes-view-mode';
import { usePrefetchDiffModels } from './hooks/use-prefetch-diff-models';

export const StagedSection = observer(function StagedSection() {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const workspace = useWorkspace();
  const git = workspace.gitWorktree;
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

  const handleUnstageSelection = () => {
    const paths = [...changesView.stagedSelection];
    void git.unstageFiles(paths).then((result) => {
      if (!result.success) {
        toast.error(`Failed to unstage changes: ${formatErrorType(result.error)} `);
        return;
      }
      changesView.clearStagedSelection();
    });
  };

  const handleUnstageAll = () => {
    void git.unstageAllFiles().then((result) => {
      if (!result.success) {
        toast.error(`Failed to unstage changes: ${formatErrorType(result.error)} `);
      }
    });
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
          />
        </div>
        {hasChanges && <CommitCard />}
      </div>
    </>
  );
});
