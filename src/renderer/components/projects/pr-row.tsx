import {
  ExternalLink,
  GitMerge,
  GitPullRequestArrow,
  GitPullRequestClosed,
  ScanSearch,
} from 'lucide-react';
import { memo, ReactNode } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { Button } from '@renderer/components/ui/button';
import { RelativeTime } from '@renderer/components/ui/relative-time';
import { rpc } from '@renderer/core/ipc';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { cn } from '@renderer/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { PrMergeLine } from './pr-merge-line';

export function StatusIcon({
  status,
  className,
  disableTooltip = false,
}: {
  disableTooltip?: boolean;
  status: PullRequest['status'];
  className?: string;
}) {
  const renderTooltip = (children: ReactNode, text: string) => {
    if (disableTooltip) return children;
    return (
      <Tooltip>
        <TooltipTrigger>{children}</TooltipTrigger>
        <TooltipContent>{text}</TooltipContent>
      </Tooltip>
    );
  };

  if (status === 'merged') {
    return renderTooltip(
      <GitMerge className={cn('size-4 shrink-0 text-purple-500', className)} />,
      'Merged'
    );
  }
  if (status === 'closed') {
    return renderTooltip(
      <GitPullRequestClosed className={cn('size-4 shrink-0 text-red-500', className)} />,
      'Closed'
    );
  }
  return renderTooltip(
    <GitPullRequestArrow className={cn('size-4 shrink-0 text-green-600', className)} />,
    'Open'
  );
}

export function PrNumberBadge({ number, className }: { number: number; className?: string }) {
  return (
    <span
      className={cn('font-mono text-xs text-foreground-muted shrink-0 tracking-wide', className)}
    >
      #{number}
    </span>
  );
}

export const PrRow = memo(function PrRow({
  pr,
  projectId,
}: {
  pr: PullRequest;
  projectId: string;
}) {
  const showCreateTaskModal = useShowModal('taskModal');

  return (
    <div className="flex relative items-start gap-3 rounded-lg p-3 py-4 hover:bg-background-1 transition-colors group">
      <div className="pt-0.5 shrink-0">
        <StatusIcon status={pr.status} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-sm text-foreground leading-snug truncate min-w-0">
              {pr.title}
            </span>
            <PrNumberBadge number={pr.metadata.number} />
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => rpc.app.openExternal(pr.url)}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open PR on github</TooltipContent>
            </Tooltip>
          </div>
          <RelativeTime value={pr.createdAt} className="text-xs text-foreground-passive" compact />
        </div>
        <PrMergeLine pr={pr} />
      </div>
      <div className="shrink-0 absolute top-0 flex h-full items-center gap-1 right-3  opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            showCreateTaskModal({ projectId, strategy: 'from-pull-request', initialPR: pr })
          }
        >
          <ScanSearch className="size-3.5" />
          Review in Task
        </Button>
      </div>
    </div>
  );
});
