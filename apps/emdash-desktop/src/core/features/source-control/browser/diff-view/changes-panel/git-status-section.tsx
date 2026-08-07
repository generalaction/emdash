import { Button, Tooltip } from '@emdash/ui/react/primitives';
import { ArrowDown, ArrowUp, GitBranch, RefreshCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  getProjectStore,
  projectDisplayName,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { getTaskGitCheckoutStore } from '@core/features/source-control/api/browser/stores/task-source-control-selectors';
import { useGitActions } from '@core/features/source-control/api/browser/use-git-actions';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { useTaskViewContext } from '@core/features/tasks/api/browser/task-state/task-view-context';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { getBranchTooltipText, getPublishTooltipText } from './git-status-tooltips';

export const GitStatusSection = observer(function GitStatusSection() {
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = getTaskStore(projectId, taskId)?.workspaceId;
  const git = getTaskGitCheckoutStore(projectId, taskId);
  const headDisplay = git?.headDisplay ?? null;
  const headKind = git?.headKind ?? 'branch';
  const isDetached = headKind === 'detached';
  const projectName = projectDisplayName(getProjectStore(projectId)) ?? 'repository';
  const repositoryStore = getGitRepositoryStore(projectId);
  const openAddRemoteModal = useOpenModal('addRemoteModal');

  const {
    hasUpstream,
    aheadCount,
    behindCount,
    fetch,
    pull,
    push,
    publish,
    isPublishing,
    isFetching,
    isPulling,
    isPushing,
  } = useGitActions(projectId, taskId);
  const shouldOfferAddRemote = (repositoryStore?.remotes.length ?? 0) === 0;

  const handlePublishClick = () => {
    if (!headDisplay || isDetached || !workspaceId) return;
    if (shouldOfferAddRemote) {
      void openAddRemoteModal({
        projectId,
        projectName,
        branchName: headDisplay,
        workspaceId,
      });
      return;
    }
    publish();
  };

  return (
    <Tooltip.Provider>
      <div className="flex flex-col gap-2 border-t border-border p-2">
        <div className="flex items-center justify-between gap-2 text-foreground-muted">
          <Tooltip.Root>
            <Tooltip.Trigger className="flex min-w-0 items-center gap-2">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate text-xs">{headDisplay}</span>
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">
              {getBranchTooltipText(headDisplay, headKind)}
            </Tooltip.Content>
          </Tooltip.Root>
          <div className="flex items-center gap-1">
            {hasUpstream && !isDetached ? (
              <>
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    <Button
                      variant="secondary"
                      size="xs"
                      icon
                      disabled={isFetching}
                      onClick={() => fetch()}
                    >
                      <RefreshCcw className="size-3" />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>{isFetching ? 'Fetching...' : 'Fetch changes'}</Tooltip.Content>
                </Tooltip.Root>
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    <Button
                      variant="secondary"
                      size="xs"
                      icon
                      disabled={isPulling || behindCount === 0}
                      onClick={() => pull()}
                    >
                      <ArrowDown className="size-3" />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    {isPulling
                      ? 'Pulling...'
                      : behindCount === 0
                        ? 'Nothing to pull'
                        : 'Pull changes'}
                  </Tooltip.Content>
                </Tooltip.Root>
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    <Button
                      variant="secondary"
                      size="xs"
                      icon
                      disabled={isPushing || aheadCount === 0}
                      onClick={() => push()}
                    >
                      <ArrowUp className="size-3" />
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    {isPushing
                      ? 'Pushing...'
                      : aheadCount === 0
                        ? 'Nothing to push'
                        : 'Push changes'}
                  </Tooltip.Content>
                </Tooltip.Root>
              </>
            ) : (
              !isDetached && (
                <Tooltip.Root>
                  <Tooltip.Trigger>
                    <Button
                      variant="secondary"
                      size="xs"
                      disabled={isPublishing || !headDisplay}
                      onClick={handlePublishClick}
                    >
                      <ArrowUp className="size-3" />
                      {isPublishing
                        ? 'Publishing...'
                        : shouldOfferAddRemote
                          ? 'Add Remote'
                          : 'Publish'}
                    </Button>
                  </Tooltip.Trigger>
                  <Tooltip.Content>
                    {getPublishTooltipText({
                      isPublishing,
                      headDisplay,
                      headKind,
                      shouldOfferAddRemote,
                    })}
                  </Tooltip.Content>
                </Tooltip.Root>
              )
            )}
          </div>
        </div>
      </div>
    </Tooltip.Provider>
  );
});
