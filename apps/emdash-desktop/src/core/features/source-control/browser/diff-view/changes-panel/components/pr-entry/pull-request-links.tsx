import { Button, Tooltip } from '@emdash/ui/react/primitives';
import { ExternalLink } from 'lucide-react';
import { openExternal } from '@core/primitives/desktop-host/browser/host-client';
import { getPrNumber, type PullRequest } from '@core/services/pull-requests/api';
// oxlint-disable-next-line emdash/core-module-boundaries -- reuse the PR service's status presentation rather than duplicating its icons and colors
import { StatusIcon } from '@core/services/pull-requests/browser/components/pr-status-icon';
// oxlint-disable-next-line emdash/core-module-boundaries -- reuse the PR service's clipboard action beside each associated PR
import { PrUrlCopyButton } from '@core/services/pull-requests/browser/components/pr-url-copy-button';

export function PullRequestLinks({ pullRequests }: { pullRequests: readonly PullRequest[] }) {
  if (pullRequests.length === 0) return null;

  return (
    <nav aria-label="Associated pull requests" className="max-h-32 shrink-0 overflow-y-auto">
      {pullRequests.map((pr) => (
        <div key={pr.url} className="group/header flex items-center gap-1">
          <PullRequestLink pr={pr} />
          <PrUrlCopyButton
            url={pr.url}
            className="opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100"
          />
        </div>
      ))}
    </nav>
  );
}

function PullRequestLink({ pr }: { pr: PullRequest }) {
  const number = getPrNumber(pr);
  const label = number === null ? 'Pull request' : `PR #${number}`;
  const status =
    pr.status === 'open'
      ? pr.isDraft
        ? 'Draft'
        : 'Open'
      : pr.status === 'merged'
        ? 'Merged'
        : 'Closed';

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="min-w-0 flex-1 justify-start"
            nativeButton={false}
            role="link"
            render={
              <a
                href={pr.url}
                aria-label={`Open ${label} in browser: ${pr.title} (${status})`}
                onClick={(event) => {
                  event.preventDefault();
                  void openExternal(pr.url);
                }}
              />
            }
          >
            <StatusIcon pr={pr} disableTooltip />
            <span className="min-w-0 flex-1 truncate text-left">{pr.title}</span>
            <span className="shrink-0">{label}</span>
            <ExternalLink aria-hidden="true" />
          </Button>
        }
      />
      <Tooltip.Content>
        {pr.title} · {status}
      </Tooltip.Content>
    </Tooltip.Root>
  );
}
