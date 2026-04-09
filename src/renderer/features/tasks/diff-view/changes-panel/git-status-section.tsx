import { ArrowDown, ArrowUp, GitBranch, RefreshCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { getTaskGitStore } from '@renderer/features/tasks/stores/task-selectors';
import { useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useGitActions } from '@renderer/features/tasks/use-git-actions';
import { useNameWithOwner } from '@renderer/lib/hooks/useNameWithOwner';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';

export const GitStatusSection = observer(function GitStatusSection() {
  const { projectId, taskId } = useTaskViewContext();
  const branchName = getTaskGitStore(projectId, taskId)?.branchStatus.data?.branch;
  const projectName = projectDisplayName(getProjectStore(projectId)) ?? 'repository';
  const { data: remoteState } = useNameWithOwner(projectId);
  const showAddRemoteModal = useShowModal('addRemoteModal');

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
  const shouldOfferAddRemote = remoteState?.status === 'no_remote';

  const handlePublishClick = () => {
    if (!branchName) return;
    if (shouldOfferAddRemote) {
      showAddRemoteModal({
        projectId,
        projectName,
        branchName,
        taskId,
      });
      return;
    }
    publish();
  };

  return (
    <TooltipProvider>
      <div className="p-2 border-t border-border flex flex-col gap-2">
        <div className="flex items-center gap-2 text-foreground-muted justify-between">
          <Tooltip>
            <TooltipTrigger className="flex min-w-0 items-center gap-2">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate text-xs">{branchName}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{branchName}</TooltipContent>
          </Tooltip>
          <div className="flex items-center gap-1">
            {hasUpstream ? (
              <>
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      disabled={isFetching}
                      onClick={() => fetch()}
                    >
                      <RefreshCcw className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{isFetching ? 'Fetching...' : 'Fetch changes'}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      disabled={isPulling || behindCount === 0}
                      onClick={() => pull()}
                    >
                      <ArrowDown className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isPulling
                      ? 'Pulling...'
                      : behindCount === 0
                        ? 'Nothing to pull'
                        : 'Pull changes'}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      variant="outline"
                      size="icon-xs"
                      disabled={isPushing || aheadCount === 0}
                      onClick={() => push()}
                    >
                      <ArrowUp className="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isPushing
                      ? 'Pushing...'
                      : aheadCount === 0
                        ? 'Nothing to push'
                        : 'Push changes'}
                  </TooltipContent>
                </Tooltip>
              </>
            ) : (
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={isPublishing || !branchName}
                    onClick={handlePublishClick}
                  >
                    <ArrowUp className="size-3" />
                    {isPublishing
                      ? 'Publishing...'
                      : shouldOfferAddRemote
                        ? 'Add Remote'
                        : 'Publish'}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isPublishing
                    ? 'Publishing...'
                    : !branchName
                      ? 'No branch checked out'
                      : shouldOfferAddRemote
                        ? 'Create or link a remote, then publish this branch'
                        : 'Publish branch'}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
});
