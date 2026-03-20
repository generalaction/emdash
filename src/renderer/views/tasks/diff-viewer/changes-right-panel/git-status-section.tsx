import { ArrowDown, ArrowUp, GitBranch, RefreshCcw } from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@renderer/components/ui/tooltip';
import { useTaskViewContext } from '../../task-view-context';
import { useBranchStatus } from '../state/use-branch-status';

export function GitStatusSection() {
  const { projectId, taskId } = useTaskViewContext();
  const { data, fetchChanges, pullChanges, pushChanges } = useBranchStatus({ projectId, taskId });
  const hasMatchingUpstream = !!data?.upstream && data.upstream.endsWith(`/${data.branch}`);
  const isUnpublished = data !== undefined && !hasMatchingUpstream;
  return (
    <div className="p-2 border-t border-border flex flex-col gap-2">
      <div className="flex items-center gap-2 text-muted-foreground justify-between">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger className="flex min-w-0 items-center gap-2">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate text-sm text-muted-foreground">{data?.branch}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom">{data?.branch}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon-xs" onClick={() => fetchChanges()}>
            <RefreshCcw className="size-3" />
          </Button>
          <Button variant="outline" size="icon-xs" onClick={() => pullChanges()}>
            <ArrowDown className="size-3" />
          </Button>
          <Button
            variant="outline"
            size={isUnpublished ? 'xs' : 'icon-xs'}
            onClick={() => pushChanges()}
          >
            <ArrowUp className="size-3" />
            {isUnpublished && 'Publish & push'}
          </Button>
        </div>
      </div>
    </div>
  );
}
