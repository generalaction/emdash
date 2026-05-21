import {
  Check,
  Clock3,
  ExternalLink,
  MessageCircle,
  ScanSearch,
  TriangleAlert,
} from 'lucide-react';
import { memo, type ComponentType } from 'react';
import { PrMergeLine } from '@renderer/lib/components/pr-merge-line';
import { PrNumberBadge } from '@renderer/lib/components/pr-number-badge';
import { StatusIcon } from '@renderer/lib/components/pr-status-icon';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatDiffLineCount } from '@renderer/utils/format-diff-line-count';
import { cn } from '@renderer/utils/utils';
import { getPrNumber, type PullRequest, type PullRequestReviewer } from '@shared/pull-requests';

export const PrRow = memo(function PrRow({
  pr,
  projectId,
}: {
  pr: PullRequest;
  projectId: string;
}) {
  const showCreateTaskModal = useShowModal('taskModal');

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
              <TooltipContent>Open PR on github</TooltipContent>
            </Tooltip>
          </div>
          <RelativeTime value={pr.createdAt} className="text-xs text-foreground-passive" compact />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <PrMergeLine pr={pr} className="flex-1" />
          <PrReviewerBadges reviewers={pr.reviewers} />
          <PrDiffStat pr={pr} />
        </div>
      </div>
      <div className="absolute top-0 right-3 flex h-full shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
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

const REVIEWER_LIMIT = 3;

const REVIEW_STATE_META = {
  approved: {
    label: 'Approved',
    Icon: Check,
    className: 'border-foreground-success/25 bg-background-success text-foreground-success',
  },
  pending: {
    label: 'Pending',
    Icon: Clock3,
    className: 'border-border bg-background-2 text-foreground-muted',
  },
  changes_requested: {
    label: 'Changes requested',
    Icon: TriangleAlert,
    className: 'border-foreground-error/25 bg-background-error text-foreground-error',
  },
  commented: {
    label: 'Commented',
    Icon: MessageCircle,
    className: 'border-foreground-warning/25 bg-background-warning text-foreground-warning',
  },
} satisfies Record<
  PullRequestReviewer['reviewState'],
  { label: string; Icon: ComponentType<{ className?: string }>; className: string }
>;

function PrReviewerBadges({ reviewers }: { reviewers: PullRequestReviewer[] }) {
  if (reviewers.length === 0) return null;

  const visible = reviewers.slice(0, REVIEWER_LIMIT);
  const overflow = reviewers.slice(REVIEWER_LIMIT);

  return (
    <div className="flex min-w-0 shrink items-center gap-1">
      {visible.map((reviewer) => (
        <ReviewerBadge key={reviewer.userId} reviewer={reviewer} />
      ))}
      {overflow.length > 0 && (
        <Tooltip>
          <TooltipTrigger className="shrink-0 rounded-full border border-border bg-background-2 px-1.5 py-0.5 text-[10px] leading-none font-medium text-foreground-muted">
            +{overflow.length}
          </TooltipTrigger>
          <TooltipContent className="max-w-56">
            <div className="flex flex-col gap-1">
              {overflow.map((reviewer) => {
                const meta = REVIEW_STATE_META[reviewer.reviewState];
                return (
                  <span key={reviewer.userId}>
                    {reviewerLabel(reviewer)}: {meta.label}
                  </span>
                );
              })}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function ReviewerBadge({ reviewer }: { reviewer: PullRequestReviewer }) {
  const meta = REVIEW_STATE_META[reviewer.reviewState];
  const Icon = meta.Icon;

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          'inline-flex max-w-32 shrink items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none',
          meta.className
        )}
      >
        {reviewer.avatarUrl ? (
          <img src={reviewer.avatarUrl} alt="" className="size-3 rounded-full" />
        ) : (
          <span className="bg-muted-foreground/20 size-3 rounded-full" />
        )}
        <span className="truncate">{reviewer.userName}</span>
        <Icon className="size-3 shrink-0" />
      </TooltipTrigger>
      <TooltipContent>
        {reviewerLabel(reviewer)}: {meta.label}
      </TooltipContent>
    </Tooltip>
  );
}

function reviewerLabel(reviewer: PullRequestReviewer): string {
  return reviewer.displayName || reviewer.userName;
}

function PrDiffStat({ pr }: { pr: PullRequest }) {
  if (pr.additions == null && pr.deletions == null) return null;

  return (
    <span className="shrink-0 text-xs tabular-nums" aria-label="Pull request diff lines">
      <span className="text-foreground-success">+{formatDiffLineCount(pr.additions ?? 0)}</span>{' '}
      <span className="text-foreground-error">-{formatDiffLineCount(pr.deletions ?? 0)}</span>
    </span>
  );
}
