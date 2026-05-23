import { ExternalLink, ScanSearch, Users } from 'lucide-react';
import { memo } from 'react';
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
import {
  getPrNumber,
  type PullRequest,
  type PullRequestReviewer,
  type PullRequestReviewState,
} from '@shared/pull-requests';

export const PrRow = memo(function PrRow({
  pr,
  projectId,
}: {
  pr: PullRequest;
  projectId: string;
}) {
  const showCreateTaskModal = useShowModal('taskModal');

  return (
    <div className="flex w-full items-start gap-3">
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
          </div>
          <div className="relative h-6 w-[4.5rem] shrink-0">
            <RelativeTime
              value={pr.createdAt}
              className="absolute top-1/2 right-0 -translate-y-1/2 text-xs whitespace-nowrap text-foreground-passive transition-opacity group-hover:pointer-events-none group-hover:opacity-0"
              compact
            />
            <div className="pointer-events-none absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => rpc.app.openExternal(pr.url)}
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                  }
                />
                <TooltipContent>Open PR on GitHub</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() =>
                        showCreateTaskModal({
                          projectId,
                          strategy: 'from-pull-request',
                          initialPR: pr,
                        })
                      }
                    >
                      <ScanSearch className="size-3.5" />
                    </Button>
                  }
                />
                <TooltipContent>Review in Task</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <PrMergeLine pr={pr} className="flex-1" />
          <div className="flex shrink-0 items-center gap-3">
            <PrReviewerBadges reviewers={pr.reviewers} />
            <PrDiffStat pr={pr} />
          </div>
        </div>
      </div>
    </div>
  );
});

const REVIEWER_LIMIT = 3;

const REVIEW_STATE_META: Record<
  PullRequestReviewState,
  { label: string; dotClass: string | null }
> = {
  approved: { label: 'Approved', dotClass: 'bg-foreground-success' },
  changes_requested: { label: 'Changes requested', dotClass: 'bg-foreground-error' },
  commented: { label: 'Commented', dotClass: null },
  pending: { label: 'Pending', dotClass: null },
};

function PrReviewerBadges({ reviewers }: { reviewers: PullRequestReviewer[] }) {
  const assigned = reviewers.filter((r) => r.reviewState !== 'commented');
  if (assigned.length === 0) return null;

  const visible = assigned.slice(0, REVIEWER_LIMIT);
  const overflow = assigned.slice(REVIEWER_LIMIT);

  return (
    <div className="flex shrink-0 items-center" aria-label="Reviewers">
      {visible.map((reviewer, i) => (
        <ReviewerAvatar
          key={reviewer.userId}
          reviewer={reviewer}
          className={i > 0 ? '-ml-1.5' : ''}
        />
      ))}
      {overflow.length > 0 && (
        <Tooltip>
          <TooltipTrigger
            className={cn(
              '-ml-1.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-background-2 text-[10px] leading-none font-medium text-foreground-muted ring-2 ring-background'
            )}
          >
            +{overflow.length}
          </TooltipTrigger>
          <TooltipContent className="max-w-56">
            <div className="flex flex-col gap-1">
              {overflow.map((reviewer) => (
                <span key={reviewer.userId}>
                  {reviewerLabel(reviewer)}: {REVIEW_STATE_META[reviewer.reviewState].label}
                </span>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function ReviewerAvatar({
  reviewer,
  className,
}: {
  reviewer: PullRequestReviewer;
  className?: string;
}) {
  const meta = REVIEW_STATE_META[reviewer.reviewState];
  const isPending = reviewer.reviewState === 'pending';

  return (
    <Tooltip>
      <TooltipTrigger
        className={cn('relative shrink-0 ring-2 ring-background', className, {
          'rounded-full': !reviewer.isTeam,
          'rounded-md': reviewer.isTeam,
        })}
      >
        {reviewer.avatarUrl ? (
          <img
            src={reviewer.avatarUrl}
            alt=""
            className={cn(
              'size-5',
              reviewer.isTeam ? 'rounded-md' : 'rounded-full',
              isPending && 'opacity-50 grayscale'
            )}
          />
        ) : reviewer.isTeam ? (
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded-md bg-background-2 text-foreground-muted',
              isPending && 'opacity-50'
            )}
          >
            <Users className="size-3" />
          </span>
        ) : (
          <span
            className={cn('block size-5 rounded-full bg-background-2', isPending && 'opacity-50')}
          />
        )}
        {meta.dotClass && (
          <span
            className={cn(
              'absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background',
              meta.dotClass
            )}
          />
        )}
      </TooltipTrigger>
      <TooltipContent>
        {reviewerLabel(reviewer)}: {meta.label}
      </TooltipContent>
    </Tooltip>
  );
}

function reviewerLabel(reviewer: PullRequestReviewer): string {
  if (reviewer.isTeam) {
    return reviewer.userName.startsWith('@') ? reviewer.userName : `@${reviewer.userName}`;
  }
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
