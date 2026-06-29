import type { GitChange } from '@emdash/core/git';
import { type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { activeDiffEntry } from '@renderer/features/tasks/diff-view/pane-selectors';
import type { BranchEmptyState } from '@renderer/features/tasks/diff-view/stores/branch-diff-store';
import {
  useTaskViewContext,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { HEAD_REF } from '@shared/core/git/types';
import { ChangesListOrTree } from './components/changes-list-or-tree';
import { ChangesViewModeToggle } from './components/changes-view-mode-toggle';
import { SectionHeader } from './components/section-header';
import { useChangesViewMode } from './hooks/use-changes-view-mode';
import { usePrefetchDiffModels } from './hooks/use-prefetch-diff-models';

export const BranchSection = observer(function BranchSection() {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const branchDiff = taskView.diffView?.branchDiff;
  const changesView = taskView.diffView?.changesView;
  const { mode: viewMode, setMode: setViewMode } = useChangesViewMode('branch');

  // Always call usePrefetchDiffModels unconditionally (React hooks rules).
  // When defaultBranchRef is null, we fall back to HEAD_REF; this is harmless
  // because the component returns null for 'no-default-branch' before any list
  // is rendered, so the prefetch callback is never actually invoked.
  const baseRef = branchDiff?.defaultBranchRef ?? HEAD_REF;
  const modifiedRef = branchDiff?.compareMode === 'committed'
    ? (branchDiff.currentBranchRef ?? undefined)
    : undefined;
  const prefetch = usePrefetchDiffModels(projectId, workspaceId, 'branch', baseRef, modifiedRef);

  if (!branchDiff || !changesView) return null;
  if (branchDiff.emptyState?.kind === 'no-default-branch') return null;

  const _activeDiff = activeDiffEntry(taskView.activePane);
  const activePath = _activeDiff?.diffGroup === 'branch' ? _activeDiff.path : undefined;

  const openDiff = (change: GitChange, preview: boolean) => {
    if (!branchDiff.defaultBranchRef) return;
    taskView.activePane.open(
      'diff',
      {
        activeFile: {
          path: change.path,
          type: 'git',
          group: 'branch',
          originalRef: branchDiff.defaultBranchRef,
          modifiedRef,
        },
        status: change.status,
      },
      { preview }
    );
  };

  return (
    <>
      <SectionHeader
        label="Branch"
        collapsed={!changesView.expandedSections.branch}
        onToggleCollapsed={() => changesView.toggleExpanded('branch')}
        count={branchDiff.files.length}
        actions={
          <>
            <ChangesViewModeToggle value={viewMode} onChange={setViewMode} label="Branch" />
            <ToggleGroup
              size="sm"
              multiple={false}
              value={[branchDiff.compareMode]}
              onValueChange={([value]) => {
                if (value === 'committed' || value === 'all') branchDiff.setCompareMode(value);
              }}
            >
              <ToggleGroupItem value="committed">Committed</ToggleGroupItem>
              <ToggleGroupItem value="all">All</ToggleGroupItem>
            </ToggleGroup>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {branchDiff.emptyState ? (
          renderEmptyState(branchDiff.emptyState)
        ) : (
          <div className="min-h-0 flex-1 px-1">
            <ChangesListOrTree
              viewMode={viewMode}
              changes={[...branchDiff.files]}
              activePath={activePath}
              onSelectChange={(c) => openDiff(c, true)}
              onDoubleClickChange={(c) => openDiff(c, false)}
              onPrefetch={(c) => prefetch(c.path)}
            />
          </div>
        )}
      </div>
    </>
  );
});

function renderEmptyState(state: BranchEmptyState): ReactNode {
  switch (state.kind) {
    case 'no-default-branch':
      // Shouldn't reach here — component returns null above for this case.
      return null;
    case 'default-not-resolved':
      return (
        <EmptyState
          label="Fetch default branch"
          description="The default branch is not present locally. Fetch the remote to compare."
        />
      );
    case 'on-default-branch':
      return (
        <EmptyState
          label="On default branch"
          description="This worktree matches the default branch — nothing to compare."
        />
      );
    case 'unborn':
      return (
        <EmptyState
          label="No commits yet"
          description="Create your first commit to compare against the default branch."
        />
      );
    case 'no-changes':
      return (
        <EmptyState
          label="No branch changes"
          description="This branch is identical to the default branch."
        />
      );
  }
}
