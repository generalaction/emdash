import { ArrowDown, ArrowUp, GitBranch, RefreshCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Button } from '@renderer/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';

export const GitStatusSection = observer(function GitStatusSection() {
  const { projectId, taskId } = useTaskViewContext();
  const git = asProvisioned(getTaskStore(projectId, taskId))?.git;

  const branchStatus = git?.branchStatus;
  const hasMatchingUpstream =
    !!branchStatus?.upstream && branchStatus.upstream.endsWith(`/${branchStatus.branch}`);
  const isUnpublished = branchStatus !== undefined && branchStatus !== null && !hasMatchingUpstream;

  return (
    <div className="p-2 border-t border-border flex flex-col gap-2">
      <div className="flex items-center gap-2 text-muted-foreground justify-between">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger className="flex min-w-0 items-center gap-2">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate text-xs text-muted-foreground">{branchStatus?.branch}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{branchStatus?.branch}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-xs" onClick={() => git?.fetchRemote()}>
            <RefreshCcw className="size-3" />
          </Button>
          <Button variant="outline" size="icon-xs" onClick={() => git?.pull()}>
            <ArrowDown className="size-3" />
          </Button>
          <Button
            variant="outline"
            size={isUnpublished ? 'xs' : 'icon-xs'}
            onClick={() => git?.push()}
          >
            <ArrowUp className="size-3" />
            {isUnpublished && 'Publish & push'}
          </Button>
        </div>
      </div>
    </div>
  );
});
