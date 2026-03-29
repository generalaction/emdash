import { formatDistanceToNow } from 'date-fns';
import {
  ExternalLink,
  GitMerge,
  GitPullRequestArrow,
  GitPullRequestClosed,
  ScanSearch,
} from 'lucide-react';
import { memo } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { rpc } from '@renderer/core/ipc';
import { SeparatorDot } from '../ui/dot';

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
      <Badge variant="outline" className="text-xs text-muted-foreground border-none p-0">
        Draft
      </Badge>
    );
  }
  switch (decision) {
    case 'REVIEW_REQUIRED':
      return (
        <Badge
          variant="outline"
          className="gap-1.5 text-xs border-none font-normal text-foreground-muted p-0"
        >
          Review required
        </Badge>
      );
    case 'APPROVED':
      return (
        <Badge
          variant="outline"
          className="gap-1.5 text-xs border-none font-normal text-foreground-muted p-0"
        >
          Approved
        </Badge>
      );
    case 'CHANGES_REQUESTED':
      return (
        <Badge
          variant="outline"
          className="gap-1.5 text-xs border-none font-normal text-foreground-muted p-0"
        >
          Changes requested
        </Badge>
      );
    default:
      return null;
  }
}

export const PrRow = memo(function PrRow({ pr }: { pr: PullRequest }) {
  const openedAgo = formatDistanceToNow(new Date(pr.createdAt), { addSuffix: true });

  return (
    <div className="flex relative items-start gap-3 rounded-lg p-3 py-4 hover:bg-background-1 transition-colors group">
      <div className="pt-0.5 shrink-0">
        <StatusIcon status={pr.status} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-sm text-foreground leading-snug truncate min-w-0">{pr.title}</span>
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="font-mono text-xs text-foreground-muted shrink-0 tracking-wide">
            #{pr.metadata.number}
          </span>
          <SeparatorDot />
          {pr.author && (
            <span className="flex items-center gap-1 text-xs text-foregrond-muted font-medium">
              {pr.author.userName}
            </span>
          )}
          <SeparatorDot />
          {pr.labels && pr.labels.length > 0 && (
            <>
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
              <SeparatorDot />
            </>
          )}
          <span className="text-xs text-foreground-muted">opened {openedAgo}</span>
          <SeparatorDot />
          <ReviewBadge decision={pr.metadata.reviewDecision} isDraft={pr.isDraft} />
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 absolute top-0 flex h-full items-center gap-1 right-3  opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="outline" size="sm" onClick={() => rpc.app.openExternal(pr.url)}>
          Open
          <ExternalLink className="size-3.5" />
        </Button>

        <Button variant="outline" size="sm">
          <ScanSearch className="size-3.5" />
          Review in Task
        </Button>
      </div>
    </div>
  );
});
