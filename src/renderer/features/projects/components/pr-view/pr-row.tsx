import { ExternalLink, ScanSearch } from 'lucide-react';
import { memo } from 'react';
import { getPrNumber, type PullRequest } from '@shared/pull-requests';
import { PrMergeLine } from '@renderer/lib/components/pr-merge-line';
import { PrNumberBadge } from '@renderer/lib/components/pr-number-badge';
import { StatusIcon } from '@renderer/lib/components/pr-status-icon';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatDiffLineCount } from '@renderer/utils/format-diff-line-count';

export const PrRow = memo(function PrRow({
  pr,
  projectId,
}: {
  pr: PullRequest;
  projectId: string;
}) {
  const showCreateTaskModal = useShowModal('taskModal');

  return (
    <div className="flex relative items-start gap-3 w-full">
      <div className="pt-0.5 shrink-0">
        <StatusIcon status={pr.status} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <span className="text-sm text-foreground leading-snug truncate min-w-0">
              {pr.title}
            </span>
            <PrNumberBadge number={getPrNumber(pr) ?? 0} />
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
        <div className="flex min-w-0 items-center gap-2">
          <PrMergeLine pr={pr} className="flex-1" />
          <PrDiffStat pr={pr} />
        </div>
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

function PrDiffStat({ pr }: { pr: PullRequest }) {
  if (pr.additions == null && pr.deletions == null) return null;

  return (
    <span className="shrink-0 text-xs tabular-nums" aria-label="Pull request diff lines">
      <span className="text-green-600">+{formatDiffLineCount(pr.additions ?? 0)}</span>{' '}
      <span className="text-red-500">-{formatDiffLineCount(pr.deletions ?? 0)}</span>
    </span>
  );
}
