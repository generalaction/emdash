import { ExternalLink, ScanSearch } from 'lucide-react';
import { memo } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { Button } from '@core/primitives/ui/browser/button';
import { PrMergeLine } from '@core/primitives/ui/browser/components/pr-merge-line';
import { PrNumberBadge } from '@core/primitives/ui/browser/components/pr-number-badge';
import { StatusIcon } from '@core/primitives/ui/browser/components/pr-status-icon';
import { RelativeTime } from '@core/primitives/ui/browser/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@core/primitives/ui/browser/tooltip';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';
import { formatDiffLineCount } from '@renderer/utils/format-diff-line-count';
import { getPrNumber, type PullRequest } from '@root/src/core/services/pull-requests/api';

export const PrRow = memo(function PrRow({
  pr,
  projectId,
}: {
  pr: PullRequest;
  projectId: string;
}) {
  const openCreateTaskModal = useOpenModal('taskModal');

  return (
    <div className="relative flex w-full items-start gap-3">
      <div className="shrink-0 pt-0.5">
        <StatusIcon pr={pr} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 truncate text-sm leading-snug text-foreground">
              {pr.title}
            </span>
            <PrNumberBadge number={getPrNumber(pr) ?? 0} />
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={() => rpc.app.openExternal(pr.url)}
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open PR on GitHub</TooltipContent>
            </Tooltip>
          </div>
          <RelativeTime value={pr.createdAt} className="text-xs text-foreground-passive" compact />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <PrMergeLine pr={pr} className="flex-1" />
          <PrDiffStat pr={pr} />
        </div>
      </div>
      <div className="absolute top-0 right-3 flex h-full shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void openCreateTaskModal({ projectId, strategy: 'from-pull-request', initialPR: pr })
          }
        >
          <ScanSearch className="size-3.5" />
          Review in Task
        </Button>
      </div>
    </div>
  );
});

function PrDiffStat({ pr }: { pr: PullRequest }) {
  if (pr.additions == null && pr.deletions == null) return null;

  return (
    <span className="shrink-0 text-xs tabular-nums" aria-label="Pull request diff lines">
      <span className="text-foreground-success">+{formatDiffLineCount(pr.additions ?? 0)}</span>{' '}
      <span className="text-foreground-error">-{formatDiffLineCount(pr.deletions ?? 0)}</span>
    </span>
  );
}
