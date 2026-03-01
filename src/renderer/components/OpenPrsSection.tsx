import React from 'react';
import { MoreHorizontal, GitPullRequest, RefreshCw, Github, User } from 'lucide-react';
import { usePullRequests, PullRequestSummary } from '../hooks/usePullRequests';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
interface OpenPrsSectionProps {
  projectPath: string;
  projectId: string;
  onOpenTask?: (task: {
    id: string;
    path: string;
    name: string;
    branch?: string;
    projectId?: string;
    prNumber?: number;
  }) => void;
}
export function OpenPrsSection({ projectPath, projectId, onOpenTask }: OpenPrsSectionProps) {
  const { prs, loading, error, refresh } = usePullRequests(projectPath);

  if (prs.length === 0 && !loading) {
    return null; // Hide section when no PRs
  }
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <GitPullRequest className="h-4 w-4" />
          Open PRs
          <span className="text-xs font-normal text-muted-foreground">({prs.length})</span>
        </h3>
        <Button variant="ghost" size="sm" onClick={() => refresh()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {prs.map((pr) => (
          <PrRow
            key={pr.number}
            pr={pr}
            projectPath={projectPath}
            projectId={projectId}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
    </div>
  );
}
function PrRow({
  pr,
  projectPath,
  projectId,
  onOpenTask,
}: {
  pr: PullRequestSummary;
  projectPath: string;
  projectId: string;
  onOpenTask?: (task: { id: string; path: string; name: string }) => void;
}) {
  const [isCreating, setIsCreating] = React.useState(false);
  const handleReviewPR = async () => {
    setIsCreating(true);
    try {
      const result = await window.electronAPI.githubCreatePullRequestWorktree({
        projectPath,
        projectId,
        prNumber: pr.number,
        prTitle: pr.title,
      });

      console.log('Review PR result:', result);

      if (result.success && result.task) {
        console.log('Calling onOpenTask with:', result.task);
        const taskWithPr = {
          ...result.task,
          prNumber: pr.number,
        };
        onOpenTask?.(taskWithPr as typeof result.task & { prNumber: number });
      } else {
        console.log('Falling back to GitHub, success:', result.success, 'task:', result.task);
        window.electronAPI.openExternal(pr.url);
      }
    } catch (error) {
      console.error('Failed to create PR worktree:', error);
    } finally {
      setIsCreating(false);
    }
  };
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">#{pr.number}</span>
          <span className="truncate text-sm font-medium text-foreground">{pr.title}</span>
          {pr.isDraft && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              Draft
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1">
          <User className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{pr.authorLogin || 'unknown'}</span>
          <span className="text-xs text-muted-foreground">→</span>
          <span className="font-mono text-xs text-muted-foreground">{pr.headRefName}</span>
        </div>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="h-7 w-7">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-40 p-1">
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onClick={handleReviewPR}
            disabled={isCreating}
          >
            {isCreating ? (
              <Spinner size="sm" className="h-3.5 w-3.5" />
            ) : (
              <GitPullRequest className="h-3.5 w-3.5" />
            )}
            Review PR
          </button>
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onClick={() => window.electronAPI.openExternal(pr.url)}
          >
            <Github className="h-3.5 w-3.5" />
            View on GitHub
          </button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
