import { Button, Tooltip } from '@emdash/ui/react/primitives';
import { ExternalLink } from 'lucide-react';
import { openExternal } from '@core/primitives/desktop-host/browser/host-client';
// oxlint-disable-next-line emdash/core-module-boundaries -- this contribution adapts the existing PR service's canonical data and shared browser presentation
import { getPrNumber, type PullRequest } from '@core/services/pull-requests/api';
// oxlint-disable-next-line emdash/core-module-boundaries -- reuse the PR service's status presentation rather than duplicating its icons and colors
import { StatusIcon } from '@core/services/pull-requests/browser/components/pr-status-icon';

export function TaskPrLink({ pr }: { pr: PullRequest | undefined }) {
  if (!pr) return null;

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
            variant="secondary"
            size="xs"
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
            {label}
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
