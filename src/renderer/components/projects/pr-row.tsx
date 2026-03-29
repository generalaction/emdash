import { formatDistanceToNow } from 'date-fns';
import { ArrowUpRight, GitMerge, GitPullRequestArrow, GitPullRequestClosed } from 'lucide-react';
import type { PullRequest } from '@shared/pull-requests';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { rpc } from '@renderer/core/ipc';

function StatusIcon({ status }: { status: PullRequest['status'] }) {
  if (status === 'merged') {
    return <GitMerge className="size-4 shrink-0 text-purple-500" />;
  }
  if (status === 'closed') {
    return <GitPullRequestClosed className="size-4 shrink-0 text-red-500" />;
  }
  return <GitPullRequestArrow className="size-4 shrink-0 text-green-500" />;
}

function ReviewBadge({
  decision,
  isDraft,
}: {
  decision: PullRequest['metadata']['reviewDecision'];
  isDraft: boolean;
}) {
  if (isDraft) {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        Draft
      </Badge>
    );
  }
  switch (decision) {
    case 'REVIEW_REQUIRED':
      return (
        <Badge variant="outline" className="gap-1.5 text-xs">
          <span className="size-1.5 rounded-full bg-yellow-500 shrink-0" />
          Review required
        </Badge>
      );
    case 'APPROVED':
      return (
        <Badge variant="outline" className="gap-1.5 text-xs">
          <span className="size-1.5 rounded-full bg-green-500 shrink-0" />
          Approved
        </Badge>
      );
    case 'CHANGES_REQUESTED':
      return (
        <Badge variant="outline" className="gap-1.5 text-xs">
          <span className="size-1.5 rounded-full bg-red-500 shrink-0" />
          Changes requested
        </Badge>
      );
    default:
      return null;
  }
}

export function PrRow({ pr }: { pr: PullRequest }) {
  const openedAgo = formatDistanceToNow(new Date(pr.createdAt), { addSuffix: true });

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border p-3 hover:bg-background-1 transition-colors">
      <div className="pt-0.5 shrink-0">
        <StatusIcon status={pr.status} />
      </div>

      <div className="flex-1 min-w-0">
        {/* Title row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm leading-snug">{pr.title}</span>
          <span className="font-mono text-xs text-muted-foreground shrink-0">
            #{pr.metadata.number}
          </span>
          <ReviewBadge decision={pr.metadata.reviewDecision} isDraft={pr.isDraft} />
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {/* Author */}
          {pr.author && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {pr.author.avatarUrl ? (
                <img
                  src={pr.author.avatarUrl}
                  alt={pr.author.userName}
                  className="size-4 rounded-full"
                />
              ) : (
                <span className="size-4 rounded-full bg-muted shrink-0" />
              )}
              {pr.author.userName}
            </span>
          )}

          {/* Labels */}
          {pr.labels && pr.labels.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {pr.labels.map((label) => (
                <span
                  key={label.name}
                  className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs leading-none"
                  style={
                    label.color
                      ? {
                          borderColor: `#${label.color}40`,
                          backgroundColor: `#${label.color}20`,
                          color: `#${label.color}`,
                        }
                      : undefined
                  }
                >
                  {label.name}
                </span>
              ))}
            </div>
          )}

          <span className="text-xs text-muted-foreground">opened {openedAgo}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0">
        <Tooltip>
          <TooltipTrigger>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-0.5 px-1.5 text-muted-foreground"
              onClick={() => rpc.app.openExternal(pr.url)}
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Open on GitHub</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
