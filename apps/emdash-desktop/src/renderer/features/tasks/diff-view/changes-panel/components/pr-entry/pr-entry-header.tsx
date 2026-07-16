import { ExternalLink } from 'lucide-react';
import { PrNavigationButton } from '@renderer/lib/components/pr-navigation-button';
import { PrNumberBadge } from '@renderer/lib/components/pr-number-badge';
import { StatusIcon } from '@renderer/lib/components/pr-status-icon';
import { PrUrlCopyButton } from '@renderer/lib/components/pr-url-copy-button';
import { getPrNumber, type PullRequest } from '@shared/core/pull-requests/pull-requests';

export function PullRequestEntryHeader({ pr }: { pr: PullRequest }) {
  return (
    <div className="group/header flex items-center justify-between gap-2">
      <PrNavigationButton
        pr={pr}
        className="group focus-visible:ring-ring/50 relative flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-colors outline-none hover:bg-background-1 focus-visible:ring-2"
      >
        <StatusIcon className="size-4" pr={pr} disableTooltip />
        <span className="min-w-0 flex-1 truncate text-sm font-normal">{pr.title}</span>
        <div className="transition-opacity duration-200 group-hover:opacity-0 group-focus-visible:opacity-0">
          <PrNumberBadge number={getPrNumber(pr) ?? 0} />
        </div>
        <span className="absolute right-0 flex items-center bg-linear-to-r from-transparent to-background pr-0.5 pl-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
          <ExternalLink aria-hidden="true" className="size-3.5 text-foreground-muted" />
        </span>
      </PrNavigationButton>
      <PrUrlCopyButton
        url={pr.url}
        className="opacity-0 group-focus-within/header:opacity-100 group-hover/header:opacity-100 focus-visible:opacity-100"
      />
    </div>
  );
}
