import { observer } from 'mobx-react-lite';
import { useWorkspace, useWorkspaceViewModel } from '@renderer/features/tasks/task-view-context';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { commitRef, type GitChange } from '@shared/core/git/git';
import { ChangesListOrTree } from './components/changes-list-or-tree';
import { ChangesViewModeToggle } from './components/changes-view-mode-toggle';
import { SectionHeader } from './components/section-header';
import { useChangesViewMode } from './hooks/use-changes-view-mode';

export const UnifiedSection = observer(function UnifiedSection() {
  const taskView = useWorkspaceViewModel();
  const workspace = useWorkspace();
  const diffView = taskView.diffView;
  const unified = diffView?.unifiedChanges;

  const { mode: viewMode, setMode: setViewMode } = useChangesViewMode('unified');

  if (!diffView || !unified || !workspace.git.hasData) return null;

  const mergeBaseSha = unified.mergeBase.data;
  const changes = unified.changes.data ?? [];
  const hasChanges = changes.length > 0;
  const isLoading = unified.changes.loading || unified.mergeBase.loading;
  const baseUnresolvable = unified.baseRef === null;
  const noMergeBase = !mergeBaseSha && unified.baseRef !== null && !isLoading;

  const activePath =
    taskView.tabManager.activeDescriptor?.kind === 'diff' &&
    taskView.tabManager.activeDescriptor.diffGroup === 'unified'
      ? taskView.tabManager.activeDescriptor.path
      : undefined;

  const open = (change: GitChange, preview: boolean) => {
    if (!mergeBaseSha) return;
    const activeFile = {
      path: change.path,
      type: 'disk' as const,
      group: 'unified' as const,
      originalRef: commitRef(mergeBaseSha),
    };
    if (preview) taskView.tabManager.openDiffPreview(activeFile, change.status);
    else taskView.tabManager.openDiff(activeFile, change.status);
  };

  return (
    <div className="flex h-full flex-col">
      <SectionHeader
        label="All changes"
        count={changes.length}
        actions={
          <ChangesViewModeToggle value={viewMode} onChange={setViewMode} label="All changes" />
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {baseUnresolvable && (
          <EmptyState
            label="No base branch"
            description="Configure a default branch in project settings to use this view."
          />
        )}
        {!baseUnresolvable && noMergeBase && (
          <EmptyState
            label="No common history"
            description="This branch shares no commits with the base. Nothing to compare."
          />
        )}
        {!baseUnresolvable && !noMergeBase && !isLoading && !hasChanges && (
          <EmptyState
            label="No changes"
            description="Nothing differs between this branch and the base."
          />
        )}
        <div className="min-h-0 flex-1 px-1">
          <ChangesListOrTree
            viewMode={viewMode}
            changes={changes}
            activePath={activePath}
            onSelectChange={(c) => open(c, true)}
            onDoubleClickChange={(c) => open(c, false)}
          />
        </div>
      </div>
    </div>
  );
});
