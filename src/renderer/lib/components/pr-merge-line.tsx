import { GitBranch } from 'lucide-react';
import type { PullRequest } from '@shared/pull-requests';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';

/**
 * Renders the GitHub-style merge summary line, e.g.:
 * "lucasmerlin wants to merge into generalaction:main from lucasmerlin:feat/my-branch"
 */
export function PrMergeLine({ pr, className }: { pr: PullRequest; className?: string }) {
  const author = pr.author?.userName;
  const baseOwner = pr.nameWithOwner.split('/')[0];
  const baseBranch = pr.metadata.baseRefName;
  const headOwner = pr.metadata.headRepository?.owner.login ?? author;
  const headBranch = pr.metadata.headRefName;

  return (
    <p className={cn('text-xs text-foreground-muted flex items-center gap-1 min-w-0', className)}>
      {author && <span className="font-medium shrink-0">{author}</span>}
      {author && ' '}
      <span className="shrink-0">wants to merge into </span>
      <PrBranchBadge owner={baseOwner} branch={baseBranch} />
      <span className="shrink-0"> from </span>
      <PrBranchBadge owner={headOwner} branch={headBranch} />
    </p>
  );
}

function PrBranchBadge({ owner, branch }: { owner?: string; branch: string }) {
  return (
    <Tooltip>
      <TooltipTrigger className="min-w-0 overflow-hidden">
        <span className="font-mono text-[10px] font-medium flex items-center gap-1 min-w-0 bg-background-2 px-1 py-0.5 rounded-md">
          <GitBranch className="size-3 shrink-0" />
          <span className="truncate">
            {owner}:{branch}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {owner}:{branch}
      </TooltipContent>
    </Tooltip>
  );
}
