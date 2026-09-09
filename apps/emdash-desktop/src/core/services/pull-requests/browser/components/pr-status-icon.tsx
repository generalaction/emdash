import { Tooltip } from '@emdash/ui/react/primitives';
import {
  GitMerge,
  GitPullRequestArrow,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';
import { type PullRequest } from '@core/services/pull-requests/api';
import { pullRequestsHostStylesContribution } from '@core/services/pull-requests/contributions/host-styles';

const { pullRequestState } = pullRequestsHostStylesContribution.exports;

type PrStatusIconInput = Pick<PullRequest, 'status' | 'isDraft'>;

export function StatusIcon({
  pr,
  className,
  disableTooltip = false,
}: {
  pr: PrStatusIconInput;
  disableTooltip?: boolean;
  className?: string;
}) {
  const { status, isDraft } = pr;
  const renderTooltip = (children: ReactNode, text: string) => {
    if (disableTooltip) return children;
    return (
      <Tooltip.Root>
        <Tooltip.Trigger>{children}</Tooltip.Trigger>
        <Tooltip.Content>{text}</Tooltip.Content>
      </Tooltip.Root>
    );
  };

  if (status === 'merged') {
    return renderTooltip(
      <GitMerge
        className={cn('size-4 shrink-0', pullRequestState({ state: 'merged' }), className)}
      />,
      'Merged'
    );
  }
  if (status === 'closed') {
    return renderTooltip(
      <GitPullRequestClosed
        className={cn('size-4 shrink-0', pullRequestState({ state: 'closed' }), className)}
      />,
      'Closed'
    );
  }
  if (status === 'open' && isDraft) {
    return renderTooltip(
      <GitPullRequestDraft
        className={cn('size-4 shrink-0', pullRequestState({ state: 'draft' }), className)}
      />,
      'Draft'
    );
  }
  return renderTooltip(
    <GitPullRequestArrow
      className={cn('size-4 shrink-0', pullRequestState({ state: 'open' }), className)}
    />,
    'Open'
  );
}
