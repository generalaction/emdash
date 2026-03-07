import React, { useMemo, useState } from 'react';
import { usePullRequests, type PullRequestSummary } from '../hooks/usePullRequests';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Spinner } from './ui/spinner';
import { useToast } from '../hooks/use-toast';
import { ArrowUpRight, ChevronDown, ChevronRight, Github, Loader2, Search } from 'lucide-react';
import type { Task } from '../types/app';

interface OpenPrsSectionProps {
  projectPath: string;
  projectId: string;
  onReviewPr: (task: Task) => void;
}

const DEFAULT_VISIBLE = 10;

const OpenPrsSection: React.FC<OpenPrsSectionProps> = ({ projectPath, projectId, onReviewPr }) => {
  const { prs, loading, error, refresh } = usePullRequests(projectPath);
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [creatingForPr, setCreatingForPr] = useState<number | null>(null);

  const filteredPrs = useMemo(() => {
    if (!searchFilter.trim()) return prs;
    const q = searchFilter.trim().toLowerCase();
    return prs.filter(
      (pr) =>
        pr.title.toLowerCase().includes(q) ||
        String(pr.number).includes(q) ||
        (pr.authorLogin && pr.authorLogin.toLowerCase().includes(q)) ||
        pr.headRefName.toLowerCase().includes(q)
    );
  }, [prs, searchFilter]);

  // Sort by updatedAt descending
  const sortedPrs = useMemo(() => {
    return [...filteredPrs].sort((a, b) => {
      if (a.updatedAt && b.updatedAt) {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      return b.number - a.number;
    });
  }, [filteredPrs]);

  const visiblePrs = showAll ? sortedPrs : sortedPrs.slice(0, DEFAULT_VISIBLE);
  const hasMore = sortedPrs.length > DEFAULT_VISIBLE && !showAll;

  const handleReviewPr = async (pr: PullRequestSummary) => {
    setCreatingForPr(pr.number);
    try {
      const result = await window.electronAPI.githubCreatePullRequestWorktree({
        projectPath,
        projectId,
        prNumber: pr.number,
        prTitle: pr.title,
      });

      if (result.success && result.task) {
        const task: Task = {
          id: result.task.id,
          projectId: result.task.projectId,
          name: result.task.name,
          branch: result.task.branch,
          path: result.task.path,
          status: result.task.status as Task['status'],
          useWorktree: true,
          metadata: result.task.metadata,
        };
        onReviewPr(task);
      } else if (result.success && result.worktree) {
        // Fallback: worktree was created but task came from an existing match
        const task: Task = {
          id: result.worktree.id || crypto.randomUUID(),
          projectId,
          name: result.taskName || `PR #${pr.number}`,
          branch: result.branchName || '',
          path: result.worktree.path || '',
          status: 'active',
          useWorktree: true,
          metadata: { prNumber: pr.number, prTitle: pr.title },
        };
        onReviewPr(task);
      } else {
        toast({
          title: 'Failed to create review task',
          description: result.error || 'Unknown error',
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Failed to create review task',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setCreatingForPr(null);
    }
  };

  if (loading && prs.length === 0) {
    return (
      <div className="mt-8 px-10">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">Open PRs</h2>
          <Spinner size="sm" className="ml-2 h-4 w-4" />
        </div>
      </div>
    );
  }

  if (error && prs.length === 0) {
    return null; // Don't show section if we can't load PRs
  }

  if (prs.length === 0) {
    return null; // No open PRs to show
  }

  return (
    <div className="mt-8 px-10">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-2 text-left"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
        <h2 className="text-xl font-semibold">Open PRs</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {prs.length}
        </span>
      </button>

      {!collapsed && (
        <div className="mt-4 flex flex-col gap-3">
          {prs.length > 5 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search PRs..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="h-9 w-full pl-10"
              />
            </div>
          )}

          {visiblePrs.length > 0 ? (
            <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {visiblePrs.map((pr) => (
                <div
                  key={pr.number}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        #{pr.number}
                      </span>
                      <span className="truncate text-sm font-medium">{pr.title}</span>
                      {pr.isDraft && (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          Draft
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate font-mono">{pr.headRefName}</span>
                      {pr.authorLogin && (
                        <>
                          <span>&middot;</span>
                          <span>{pr.authorLogin}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={creatingForPr === pr.number}
                      onClick={() => handleReviewPr(pr)}
                    >
                      {creatingForPr === pr.number ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : null}
                      Review
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-0.5 px-1.5 text-muted-foreground"
                      onClick={() => window.electronAPI.openExternal(pr.url)}
                      title="View on GitHub"
                    >
                      <Github className="h-3.5 w-3.5" />
                      <ArrowUpRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No PRs match your search.
            </p>
          )}

          {hasMore && (
            <button
              type="button"
              className="cursor-pointer text-center text-sm text-muted-foreground underline"
              onClick={() => setShowAll(true)}
            >
              Show all {sortedPrs.length} PRs
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default OpenPrsSection;
