import { Minus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { selectAheadCount } from '@renderer/core/stores/diff-selectors';
import { getTaskView } from '@renderer/core/stores/task-selectors';
import {
  useRequireProvisionedTask,
  useTaskViewContext,
} from '@renderer/views/tasks/task-view-context';
import { ActionCard } from './action-card';
import { CommitCard } from './commit-card';
import { PushCard } from './push-card';
import { SectionHeader } from './section-header';
import { usePrefetchModels } from './use-prefetch-models';
import { VirtualizedChangesList } from './virtualized-changes-list';

export const StagedSection = observer(function StagedSection() {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useRequireProvisionedTask();
  const git = provisioned.workspace.git;
  const changesView = provisioned.taskView.diffView.changesView;
  const diffView = provisioned.taskView.diffView;

  const changes = git.stagedFileChanges;
  const hasChanges = changes.length > 0;
  const selectedPaths = changesView.stagedSelection;
  const selectionState = changesView.stagedSelectionState;
  const hasPRs = changesView.expandedSections.pullRequests;

  const activePath =
    getTaskView(projectId, taskId)?.view === 'diff' && diffView.activeFile?.type === 'staged'
      ? diffView.activeFile.path
      : undefined;

  const prefetch = usePrefetchModels(projectId, taskId, 'staged', 'HEAD');

  const handleSelectChange = (path: string) => {
    diffView.setActiveFile({ path, type: 'staged', originalRef: 'HEAD' });
    getTaskView(projectId, taskId)?.setView('diff');
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

  const handleCommit = (message: string) => {
    void git.commit(message);
    changesView.setExpanded({ unstaged: true, staged: false, pullRequests: hasPRs });
  };

  const ahead = selectAheadCount(git);

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
        <div className="min-h-0 flex-1 p-1">
          <VirtualizedChangesList
            changes={changes}
            isSelected={(path) => selectedPaths.has(path)}
            onToggleSelect={(path) => changesView.toggleStagedItem(path)}
            activePath={activePath}
            onSelectChange={(change) => handleSelectChange(change.path)}
            onPrefetch={(change) => prefetch(change.path)}
          />
        </div>
        {hasChanges && <CommitCard onCommit={handleCommit} />}
        {!hasChanges && ahead > 0 && <PushCard />}
      </div>
    </>
  );
});
