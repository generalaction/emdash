import type { GitChange } from '@emdash/core/git';
import { Plus, Undo2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { activeDiffEntry } from '@renderer/features/tasks/diff-view/pane-selectors';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { HEAD_REF } from '@shared/core/git/types';
import { commitRef } from '@shared/core/git/utils';
import { formatErrorType } from '../../utils';
import { ActionCard } from './components/action-card';
import { ChangesListOrTree } from './components/changes-list-or-tree';
import { ChangesScopeToggle } from './components/changes-scope-toggle';
import { ChangesViewModeToggle } from './components/changes-view-mode-toggle';
import { CommitCard } from './components/commit-card';
import { SectionHeader } from './components/section-header';
import { useChangesViewMode } from './hooks/use-changes-view-mode';
import { usePrefetchDiffModels } from './hooks/use-prefetch-diff-models';

export const UnstagedSection = observer(function UnstagedSection() {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const workspace = useWorkspace();
  const git = workspace.gitWorktree;
  const diffView = taskView.diffView;
  const changesView = diffView?.changesView;

  const scope = changesView?.scope ?? 'session';
  const isLastTurn = scope === 'last-turn';
  const lastTurn = git.lastTurnChanges;
  const changes = isLastTurn ? (lastTurn?.changes ?? []) : git.unstagedFileChanges;
  const hasChanges = changes.length > 0;
  const hasStagedChanges = git.stagedFileChanges.length > 0;

  // Keep the last-turn diff fresh while that scope is active and the worktree changes.
  const statusRevision = git.statusRevision;
  useEffect(() => {
    if (isLastTurn) void git.refreshLastTurn();
  }, [isLastTurn, statusRevision, git]);

  const _activeDiff = activeDiffEntry(taskView.activePane);
  const activePath = isLastTurn
    ? _activeDiff?.diffGroup === 'git'
      ? _activeDiff.path
      : undefined
    : _activeDiff?.diffGroup === 'disk'
      ? _activeDiff.path
      : undefined;

  // Session opens files against HEAD on the 'disk' group; last-turn opens the immutable
  // baseTree -> headTree snapshot on the 'git' group (see openChange below). Prefetch has to
  // mirror whichever group and refs will actually be opened, or it warms the wrong models and
  // every last-turn hover misses the cache.
  const diskPrefetch = usePrefetchDiffModels(projectId, workspaceId, 'disk', HEAD_REF);
  const gitPrefetch = usePrefetchDiffModels(
    projectId,
    workspaceId,
    'git',
    lastTurn ? commitRef(lastTurn.baseTree) : HEAD_REF,
    lastTurn ? commitRef(lastTurn.headTree) : undefined
  );
  const prefetch = isLastTurn ? gitPrefetch : diskPrefetch;

  const { mode: viewMode, setMode: setViewMode } = useChangesViewMode('unstaged');

  const showConfirmActionModal = useShowModal('confirmActionModal');

  if (!diffView || !changesView) return null;

  const openChange = (change: GitChange, preview: boolean) => {
    // Session: working tree vs HEAD (disk group). Last turn: the immutable baseTree ->
    // headTree snapshot diff, rendered via the arbitrary ref-to-ref 'git' group (#1635).
    const activeFile =
      isLastTurn && lastTurn
        ? {
            path: change.path,
            type: 'git' as const,
            group: 'git' as const,
            originalRef: commitRef(lastTurn.baseTree),
            modifiedRef: commitRef(lastTurn.headTree),
          }
        : {
            path: change.path,
            type: 'disk' as const,
            group: 'disk' as const,
            originalRef: commitRef('HEAD'),
          };
    taskView.activePane.open('diff', { activeFile, status: change.status }, { preview });
  };

  const handleSelectChange = (change: GitChange) => openChange(change, true);
  const handleDoubleClickChange = (change: GitChange) => openChange(change, false);

  const handleDiscardSelection = () => {
    const paths = [...changesView.unstagedSelection];
    showConfirmActionModal({
      title: 'Discard Files Changes',
      variant: 'destructive',
      description:
        'Are you sure you want to discard the changes to the selected files? This can not be undone.',
      onSuccess: () => {
        void (async () => {
          const result = await git.discardFiles(paths);
          if (!result.success) {
            toast.error(`Failed to discard changes: ${formatErrorType(result.error)} `);
            return;
          }
          changesView.removeUnstagedSelection(paths);
        })();
      },
    });
  };

  const handleDiscardAll = () => {
    showConfirmActionModal({
      title: 'Discard All Changes',
      variant: 'destructive',
      description: 'Are you sure you want to discard all changes? This can not be undone.',
      onSuccess: () =>
        void git.discardAllFiles().then((result) => {
          if (!result.success) {
            toast.error(`Failed to discard changes: ${formatErrorType(result.error)} `);
          }
        }),
    });
  };

  const handleStageSelection = () => {
    const paths = [...changesView.unstagedSelection];
    void git.stageFiles(paths).then((result) => {
      if (!result.success) {
        toast.error(`Failed to stage changes: ${formatErrorType(result.error)} `);
        return;
      }
      changesView.removeUnstagedSelection(paths);
    });
  };

  const handleStageAll = () => {
    void git.stageAllFiles().then((result) => {
      if (!result.success) {
        toast.error(`Failed to stage changes: ${formatErrorType(result.error)} `);
      }
    });
  };

  return (
    <>
      <SectionHeader
        label={isLastTurn ? 'Last turn' : 'Changed'}
        collapsed={!changesView.expandedSections.unstaged}
        onToggleCollapsed={() => changesView.toggleExpanded('unstaged')}
        count={changes.length}
        selectionState={isLastTurn ? undefined : changesView.unstagedSelectionState}
        onToggleAll={isLastTurn ? undefined : () => changesView.toggleAllUnstaged()}
        actions={
          <>
            <ChangesScopeToggle scope={scope} onChange={(next) => changesView.setScope(next)} />
            <ChangesViewModeToggle value={viewMode} onChange={setViewMode} label="Changed" />
          </>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!hasChanges && (
          <EmptyState
            label={
              isLastTurn
                ? lastTurn
                  ? 'No changes this turn'
                  : 'No turn recorded yet'
                : 'Working tree clean'
            }
            description={
              isLastTurn
                ? lastTurn
                  ? 'The most recent turn made no file changes.'
                  : 'The agent has not run a turn in this task yet. Changes from the next turn will show up here.'
                : 'No uncommitted file changes.'
            }
          />
        )}
        {!isLastTurn && hasChanges && (
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
            rootPath={workspace.path}
            isSelected={(path) => !isLastTurn && changesView.unstagedSelection.has(path)}
            onToggleSelect={(path) => {
              if (!isLastTurn) changesView.toggleUnstagedItem(path);
            }}
            activePath={activePath}
            onSelectChange={handleSelectChange}
            onDoubleClickChange={handleDoubleClickChange}
            onPrefetch={(change) => prefetch(change.path)}
          />
        </div>
        {!isLastTurn && hasChanges && !hasStagedChanges && <CommitCard autoStage />}
      </div>
    </>
  );
});
