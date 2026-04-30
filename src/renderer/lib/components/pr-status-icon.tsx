import { GitMerge, GitPullRequestArrow, GitPullRequestClosed } from 'lucide-react';
import { type ReactNode } from 'react';
import { type PullRequest } from '@shared/pull-requests';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

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
