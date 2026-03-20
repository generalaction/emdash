import {
  ArrowLeft,
  ArrowUpRight,
  CircleDot,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
} from 'lucide-react';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { rpc } from '@renderer/core/ipc';
import type { PullRequestSummary } from '@renderer/lib/github';
import { cn } from '@renderer/lib/utils';
import { ChecksButton } from './checks-buttons';

interface StatusSectionProps {
  pr: PullRequestSummary;
  nameWithOwner: string;
}

function getPrStatusDisplay(pr: PullRequestSummary) {
  if (pr.state === 'MERGED') {
    return { color: 'text-purple-500', label: 'Merged', icon: GitMerge };
  }
  if (pr.state === 'CLOSED') {
    return { color: 'text-red-500', label: 'Closed', icon: GitPullRequestClosed };
  }
  if (pr.isDraft) {
    return { color: 'text-muted-foreground', label: 'Draft', icon: GitPullRequest };
  }
  return { color: 'text-green-500', label: 'Open', icon: CircleDot };
}

export const StatusSection = ({ pr, nameWithOwner }: StatusSectionProps) => {
  const { color: statusColor, label: statusLabel, icon: StatusIcon } = getPrStatusDisplay(pr);

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className={cn('shrink-0 gap-1', statusColor)}>
          <StatusIcon className="size-3" />
          {statusLabel}
        </Badge>
        <span className="flex-1 min-w-0 truncate text-sm font-medium">{pr.title}</span>
        <div className="shrink-0 flex items-center gap-1">
          <ChecksButton nameWithOwner={nameWithOwner} prNumber={pr.number} prUrl={pr.url} />
          <Button
            variant="outline"
            size="icon-xs"
            title="Open in browser"
            onClick={() => rpc.app.openExternal(pr.url)}
          >
            <ArrowUpRight className="size-3" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="truncate">{nameWithOwner}</span>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant="secondary" className="gap-1 font-mono text-xs">
            <GitBranch className="size-3" />
            {pr.baseRefName}
          </Badge>
          <ArrowLeft className="size-3" />
          <Badge variant="secondary" className="gap-1 font-mono text-xs">
            <GitBranch className="size-3" />
            {pr.headRefName}
          </Badge>
        </div>
      </div>
    </div>
  );
};
