import { Minus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { commitRef, HEAD_REF } from '@shared/git';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ActionCard } from './components/action-card';
import { CommitCard } from './components/commit-card';
import { SectionHeader } from './components/section-header';
import { VirtualizedChangesList } from './components/virtualized-changes-list';
import { usePrefetchDiffModels } from './hooks/use-prefetch-diff-models';

export const StagedSection = observer(function StagedSection() {
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const git = provisioned.workspace.git;
  const changesView = provisioned.taskView.diffView.changesView;
  const diffView = provisioned.taskView.diffView;

  const changes = git.stagedFileChanges;
  const hasChanges = changes.length > 0;
  const selectedPaths = changesView.stagedSelection;
  const selectionState = changesView.stagedSelectionState;
  const hasPRs = changesView.expandedSections.pullRequests;

  const activePath =
    provisioned.taskView.view === 'diff' && diffView.activeFile?.group === 'staged'
      ? diffView.activeFile.path
      : undefined;

  const prefetch = usePrefetchDiffModels(projectId, provisioned.workspaceId, 'staged', HEAD_REF);

  const handleSelectChange = (path: string) => {
    diffView.setActiveFile({ path, type: 'git', group: 'staged', originalRef: commitRef('HEAD') });
    provisioned.taskView.setView('diff');
  };

  const handleUnstageSelection = () => {
    const paths = [...selectedPaths];
    const remaining = changes.length - paths.length;
    void git.unstageFiles(paths);
    changesView.clearStagedSelection();
    changesView.setExpanded({
      unstaged: true,
      staged: remaining > 0,
      pullRequests: hasPRs,
    });
  };

  const handleUnstageAll = () => {
    void git.unstageAllFiles();
    changesView.setExpanded({ unstaged: true, staged: false, pullRequests: hasPRs });
  };

  return (
    <>
      <SectionHeader
        label="Staged"
        count={changes.length}
        selectionState={selectionState}
        onToggleAll={() => changesView.toggleAllStaged()}
        actions={undefined}
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
        {hasChanges && selectedPaths.size > 0 && (
          <ActionCard
            selectedCount={selectedPaths.size}
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
          <VirtualizedChangesList
            changes={changes}
            isSelected={(path) => selectedPaths.has(path)}
            onToggleSelect={(path) => changesView.toggleStagedItem(path)}
            activePath={activePath}
            onSelectChange={(change) => handleSelectChange(change.path)}
            onPrefetch={(change) => prefetch(change.path)}
          />
        </div>
        {hasChanges && <CommitCard />}
      </div>
    </>
  );
});
