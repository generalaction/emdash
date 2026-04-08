import { Plus, Undo2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { getTaskView } from '@renderer/core/stores/task-selectors';
import {
  useRequireProvisionedTask,
  useTaskViewContext,
} from '@renderer/views/tasks/task-view-context';
import { ActionCard } from './action-card';
import { SectionHeader } from './section-header';
import { usePrefetchModels } from './use-prefetch-models';
import { VirtualizedChangesList } from './virtualized-changes-list';

export const UnstagedSection = observer(function UnstagedSection() {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useRequireProvisionedTask();
  const git = provisioned.workspace.git;
  const changesView = provisioned.taskView.diffView.changesView;
  const diffView = provisioned.taskView.diffView;

  const changes = git.unstagedFileChanges;
  const hasChanges = changes.length > 0;
  const selectedPaths = changesView.unstagedSelection;
  const selectionState = changesView.unstagedSelectionState;

  const activePath =
    getTaskView(projectId, taskId)?.view === 'diff' && diffView.activeFile?.type === 'disk'
      ? diffView.activeFile.path
      : undefined;

  const prefetch = usePrefetchModels(projectId, taskId, 'disk', 'HEAD');

  const showConfirmActionModal = useShowModal('confirmActionModal');

  const handleSelectChange = (path: string) => {
    diffView.setActiveFile({ path, type: 'disk', originalRef: 'HEAD' });
    getTaskView(projectId, taskId)?.setView('diff');
  };

  const handleDiscardSelection = () => {
    const paths = [...selectedPaths];
    const remaining = changes.length - paths.length;
    showConfirmActionModal({
      title: 'Discard Files Changes',
      variant: 'destructive',
      description:
        'Are you sure you want to discard the changes to the selected files? This can not be undone.',
      onSuccess: async () => {
        await git.discardFiles(paths);
        changesView.clearUnstagedSelection();
        changesView.setExpanded((prev) => ({ ...prev, unstaged: remaining > 0 }));
      },
    });
  };

  const handleDiscardAll = () => {
    showConfirmActionModal({
      title: 'Discard All Changes',
      variant: 'destructive',
      description: 'Are you sure you want to discard all changes? This can not be undone.',
      onSuccess: async () => {
        await git.discardAllFiles();
        changesView.setExpanded((prev) => ({ ...prev, unstaged: false }));
      },
    });
  };

  const handleStageSelection = () => {
    const paths = [...selectedPaths];
    const remaining = changes.length - paths.length;
    void git.stageFiles(paths);
    changesView.clearUnstagedSelection();
    changesView.setExpanded({ unstaged: remaining > 0, staged: true, pullRequests: false });
  };

  const handleStageAll = () => {
    void git.stageAllFiles();
    changesView.setExpanded({ unstaged: false, staged: true, pullRequests: false });
  };

  return (
    <>
      <SectionHeader
        label="Changed"
        collapsed={!changesView.expandedSections.unstaged}
        onToggleCollapsed={() => changesView.toggleExpanded('unstaged')}
        count={changes.length}
        selectionState={selectionState}
        onToggleAll={() => changesView.toggleAllUnstaged()}
        actions={undefined}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!hasChanges && (
          <EmptyState label="Working tree clean" description="No uncommitted file changes." />
        )}
        {hasChanges && (
          <ActionCard
            selectedCount={selectedPaths.size}
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
        <div className="min-h-0 flex-1 p-1">
          <VirtualizedChangesList
            changes={changes}
            isSelected={(path) => selectedPaths.has(path)}
            onToggleSelect={(path) => changesView.toggleUnstagedItem(path)}
            activePath={activePath}
            onSelectChange={(change) => handleSelectChange(change.path)}
            onPrefetch={(change) => prefetch(change.path)}
          />
        </div>
      </div>
    </>
  );
});
