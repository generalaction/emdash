import { ArrowUpRight, Github, MessageSquare } from 'lucide-react';
import { Badge } from '@/renderer/components/ui/badge';
import { PullRequest } from '@shared/pull-requests';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { rpc } from '@renderer/core/ipc';
import { Button } from '../ui/button';

function getReviewBadge(decision: PullRequest['metadata']['reviewDecision']) {
  switch (decision) {
    case 'REVIEW_REQUIRED':
      return { label: 'Review required', dot: 'bg-yellow-500' };
    case 'APPROVED':
      return { label: 'Approved', dot: 'bg-green-500' };
    case 'CHANGES_REQUESTED':
      return { label: 'Changes requested', dot: 'bg-red-500' };
    default:
      return null;
  }
}

export function PrRow({ pr }: { pr: PullRequest }) {
  const reviewInfo = getReviewBadge(pr.metadata.reviewDecision);

  return (
    <div className="flex items-start justify-between rounded-lg border border-border p-4 h-24">
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="font-mono text-xs rounded-sm">
            #{pr.metadata.number}
          </Badge>
          <span className="font-medium text-sm">{pr.title}</span>
          {reviewInfo && (
            <Badge variant="outline" className="gap-1.5">
              <span className={`size-2 rounded-full ${reviewInfo.dot}`} />
              {reviewInfo.label}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <code className="text-xs">{pr.metadata.headRefName}</code>
          {pr.author && (
            <>
              <span>·</span>
              <span>{pr.author.userName}</span>
            </>
          )}
        </div>

        {pr.metadata.reviewers.length > 0 && (
          <div className="flex items-center gap-1.5 pt-0.5">
            {pr.metadata.reviewers.map((r) => (
              <Badge key={r.login} variant="outline" className="gap-1 text-xs">
                <MessageSquare className="size-3" />
                {r.login}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-4">
        <Tooltip>
          <TooltipTrigger>
            <Button variant="outline" size="sm" onClick={() => rpc.app.openExternal(pr.url)}>
              Review
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Review this PR in emdash</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-0.5 px-1.5 text-muted-foreground"
              onClick={() => rpc.app.openExternal(pr.url)}
            >
              <Github className="h-3.5 w-3.5" />
              <ArrowUpRight className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Open this pull request on GitHub</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
