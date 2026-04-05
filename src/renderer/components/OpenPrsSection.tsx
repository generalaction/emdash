import React, { useMemo, useState } from 'react';
import type { GitPlatform } from '../../shared/git/platform';
import {
  usePullRequests,
  type PullRequestSummary,
  type PullRequestReviewer,
} from '../hooks/usePullRequests';
import {
  normalizePullRequestSearchQuery,
  getPullRequestFilterPresets,
  resolvePullRequestFilterId,
} from '../lib/pullRequestFilters';
import { cn } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useToast } from '../hooks/use-toast';
import { useTaskManagementContext } from '../contexts/TaskManagementContext';
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Github,
  Gitlab,
  Loader2,
  MessageSquare,
  Search,
  XCircle,
} from 'lucide-react';
import type { Task } from '../types/app';
import { getPlatformLabels } from '../lib/gitPlatformLabels';

interface OpenPrsSectionProps {
  projectPath: string;
  projectId: string;
  gitPlatform?: GitPlatform;
}

const DEFAULT_VISIBLE = 10;
const PR_RESULT_ROW_HEIGHT_PX = 72;
const PR_RESULTS_MIN_HEIGHT_PX = DEFAULT_VISIBLE * PR_RESULT_ROW_HEIGHT_PX;
const prBadgeClass =
  'inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground';
const filterTabBadgeClass =
  'inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium leading-none shadow-sm transition-colors';
const activeFilterTabBadgeClass =
  'border-foreground/10 bg-foreground text-background hover:bg-foreground/90';
const inactiveFilterTabBadgeClass =
  'border-border/70 bg-muted/35 text-foreground/80 hover:border-border hover:bg-muted/60 hover:text-foreground';
const customFilterBadgeClass =
  'inline-flex h-8 items-center rounded-md border border-primary/20 bg-primary/10 px-2.5 text-xs font-medium text-primary';
const subtleReviewBadgeClass =
  'h-5 rounded-md border px-2 text-[11px] font-medium tracking-tight shadow-none';
const reviewerBadgeClass =
  'h-5 max-w-[11rem] rounded-md border border-border/60 bg-background/80 px-2 text-[11px] font-medium tracking-tight text-foreground/80 shadow-none backdrop-blur-[1px]';

const MAX_VISIBLE_REVIEWERS = 3;

function getReviewDecisionConfig(decision: string): {
  label: string;
  className: string;
  dotClassName: string;
} | null {
  switch (decision) {
    case 'APPROVED':
      return {
        label: 'Approved',
        className:
          'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-300',
        dotClassName: 'bg-emerald-500',
      };
    case 'CHANGES_REQUESTED':
      return {
        label: 'Changes requested',
        className: 'border-rose-500/20 bg-rose-500/[0.07] text-rose-700 dark:text-rose-300',
        dotClassName: 'bg-rose-500',
      };
    case 'REVIEW_REQUIRED':
      return {
        label: 'Review required',
        className: 'border-amber-500/20 bg-amber-500/[0.07] text-amber-700 dark:text-amber-300',
        dotClassName: 'bg-amber-500',
      };
    default:
      return null;
  }
}

function getReviewStateMeta(state?: PullRequestReviewer['state']): {
  label: string;
  dotClassName: string;
  showCommentIcon?: boolean;
} {
  switch (state) {
    case 'APPROVED':
      return {
        label: 'Approved',
        dotClassName: 'bg-emerald-500',
      };
    case 'CHANGES_REQUESTED':
      return {
        label: 'Changes requested',
        dotClassName: 'bg-rose-500',
      };
    case 'COMMENTED':
      return {
        label: 'Commented',
        dotClassName: 'bg-sky-500',
        showCommentIcon: true,
      };
    case 'PENDING':
      return {
        label: 'Pending review',
        dotClassName: 'bg-amber-500',
      };
    case 'DISMISSED':
      return {
        label: 'Dismissed',
        dotClassName: 'bg-slate-400 dark:bg-slate-500',
      };
    default:
      return {
        label: 'Reviewer',
        dotClassName: 'bg-slate-300 dark:bg-slate-600',
      };
  }
}

function CheckStatusIcon({
  status,
}: {
  status: 'pass' | 'fail' | 'pending' | 'none' | null | undefined;
}) {
  if (!status || status === 'none') return null;

  if (status === 'pass') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="shrink-0">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">All checks passed</TooltipContent>
      </Tooltip>
    );
  }
  if (status === 'fail') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="shrink-0">
            <XCircle className="h-4 w-4 text-red-500" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">Some checks failed</TooltipContent>
      </Tooltip>
    );
  }
  // pending
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0">
          <Clock className="h-4 w-4 text-amber-500" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">Checks in progress</TooltipContent>
    </Tooltip>
  );
}

const ReviewerBadge: React.FC<{ reviewer: PullRequestReviewer }> = ({ reviewer }) => {
  const meta = getReviewStateMeta(reviewer.state);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn(reviewerBadgeClass, 'justify-start gap-1.5')}>
          {meta.showCommentIcon ? (
            <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dotClassName)} />
          )}
          <span className="truncate">{reviewer.login}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        {reviewer.login}: {meta.label}
      </TooltipContent>
    </Tooltip>
  );
};

const ReviewersList: React.FC<{ reviewers: PullRequestReviewer[] }> = ({ reviewers }) => {
  if (reviewers.length === 0) return null;

  const visible = reviewers.slice(0, MAX_VISIBLE_REVIEWERS);
  const overflow = reviewers.slice(MAX_VISIBLE_REVIEWERS);

  return (
    <div className="flex items-center gap-1">
      {visible.map((reviewer) => (
        <ReviewerBadge key={reviewer.login} reviewer={reviewer} />
      ))}
      {overflow.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={cn(
                reviewerBadgeClass,
                'max-w-none border-border/60 bg-muted/35 text-muted-foreground'
              )}
            >
              +{overflow.length}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <div className="flex flex-col gap-1">
              {overflow.map((reviewer) => (
                <span key={reviewer.login}>
                  {reviewer.login}: {getReviewStateMeta(reviewer.state).label}
                </span>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};

const OpenPrsSection: React.FC<OpenPrsSectionProps> = ({ projectPath, projectId, gitPlatform }) => {
  const labels = getPlatformLabels(gitPlatform);
  const filterPresets = getPullRequestFilterPresets(gitPlatform);
  const { toast } = useToast();
  const { handleOpenExternalTask } = useTaskManagementContext();
  const [collapsed, setCollapsed] = useState(false);
  const [creatingForPr, setCreatingForPr] = useState<number | null>(null);
  const [appliedQuery, setAppliedQuery] = useState('');
  const [draftQuery, setDraftQuery] = useState('');
  const { prs, totalCount, loading, loadingMore, error, hasFetched, loadMore, hasMore } =
    usePullRequests(projectPath, true, DEFAULT_VISIBLE, appliedQuery);

  const activeFilterId = resolvePullRequestFilterId(appliedQuery, filterPresets);
  const normalizedDraftQuery = normalizePullRequestSearchQuery(draftQuery);
  const isQueryDirty = normalizedDraftQuery !== appliedQuery;
  const isCustomQueryActive = activeFilterId === 'custom' && !!appliedQuery;

  const sortedPrs = useMemo(() => {
    return [...prs].sort((a, b) => {
      if (a.updatedAt && b.updatedAt) {
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
      return b.number - a.number;
    });
  }, [prs]);

  const applySearchQuery = (nextQuery: string) => {
    const normalizedQuery = normalizePullRequestSearchQuery(nextQuery);
    setAppliedQuery(normalizedQuery);
    setDraftQuery(normalizedQuery);
  };

  const handleQuerySubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    applySearchQuery(draftQuery);
  };

  const handleReviewPr = async (pr: PullRequestSummary) => {
    setCreatingForPr(pr.number);
    try {
      const result = await window.electronAPI.gitPlatformCreateReviewWorktree({
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
          agentId: result.task.agentId ?? undefined,
          useWorktree: true,
          metadata: result.task.metadata,
        };
        handleOpenExternalTask(task);
      } else if (result.success && result.worktree) {
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
        handleOpenExternalTask(task);
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

  if (!hasFetched && loading && prs.length === 0 && !appliedQuery) {
    return null;
  }

  if (!hasFetched && error && prs.length === 0 && !appliedQuery) {
    return null;
  }

  if (hasFetched && !loading && !error && totalCount === 0 && prs.length === 0 && !appliedQuery) {
    return null;
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
        <h2 className="text-xl font-semibold">{labels.openSection}</h2>
        <span className={prBadgeClass}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : totalCount}
        </span>
      </button>

      {!collapsed && (
        <TooltipProvider delayDuration={100}>
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {filterPresets.map((preset) => {
                const isActive = activeFilterId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={cn(
                      filterTabBadgeClass,
                      isActive ? activeFilterTabBadgeClass : inactiveFilterTabBadgeClass
                    )}
                    onClick={() => applySearchQuery(preset.query)}
                  >
                    {preset.label}
                  </button>
                );
              })}
              {isCustomQueryActive ? (
                <span className={customFilterBadgeClass}>Custom query</span>
              ) : null}
            </div>

            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={handleQuerySubmit}>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={
                    gitPlatform === 'gitlab'
                      ? 'Search merge requests...'
                      : 'GitHub query, e.g. author:@me review-requested:@me'
                  }
                  value={draftQuery}
                  onChange={(e) => setDraftQuery(e.target.value)}
                  className="h-9 w-full pl-10"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  size="sm"
                  className="h-9"
                  disabled={!isQueryDirty || loading}
                  variant={isQueryDirty ? 'default' : 'outline'}
                >
                  Apply
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  disabled={!appliedQuery && !draftQuery}
                  onClick={() => applySearchQuery('')}
                >
                  Clear
                </Button>
              </div>
            </form>

            <p className="text-xs text-muted-foreground">
              {gitPlatform === 'gitlab' ? (
                'Search by title or free-text terms.'
              ) : (
                <>
                  Use GitHub PR search syntax like <code>review-requested:@me</code>,{' '}
                  <code>author:@me</code>, <code>draft:true</code>, or free-text terms.
                </>
              )}
            </p>

            <div className="flex flex-col" style={{ minHeight: `${PR_RESULTS_MIN_HEIGHT_PX}px` }}>
              {loading && prs.length === 0 ? (
                <div className="flex min-h-full flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/10 px-4 py-4">
                  <p className="text-center text-sm text-muted-foreground">
                    Loading {labels.prNounFull.toLowerCase()}s...
                  </p>
                </div>
              ) : error && prs.length === 0 ? (
                <div className="flex min-h-full flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/10 px-4 py-4">
                  <p className="text-center text-sm text-muted-foreground">
                    Unable to load {labels.prNounFull.toLowerCase()}s for this filter.
                  </p>
                </div>
              ) : sortedPrs.length > 0 ? (
                <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
                  {sortedPrs.map((pr) => (
                    <div
                      key={pr.number}
                      className="flex min-h-[72px] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className={`${prBadgeClass} shrink-0`}>#{pr.number}</span>
                          <CheckStatusIcon status={pr.checksStatus} />
                          <span className="truncate text-sm font-medium">{pr.title}</span>
                          {pr.isDraft ? (
                            <span className={`${prBadgeClass} shrink-0`}>Draft</span>
                          ) : null}
                          {pr.reviewDecision &&
                            (() => {
                              const config = getReviewDecisionConfig(pr.reviewDecision);
                              if (!config) return null;
                              return (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        subtleReviewBadgeClass,
                                        'shrink-0 gap-1.5',
                                        config.className
                                      )}
                                    >
                                      <span
                                        className={cn(
                                          'h-1.5 w-1.5 shrink-0 rounded-full',
                                          config.dotClassName
                                        )}
                                      />
                                      {config.label}
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    Review status: {config.label}
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })()}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate font-mono">{pr.headRefName}</span>
                          {pr.authorLogin ? (
                            <>
                              <span>&middot;</span>
                              <span>{pr.authorLogin}</span>
                            </>
                          ) : null}
                          {(pr.additions != null || pr.deletions != null) && (
                            <>
                              <span>&middot;</span>
                              <span className="inline-flex items-center gap-1 font-medium">
                                {pr.additions != null && (
                                  <span className="text-green-600 dark:text-green-400">
                                    +{pr.additions.toLocaleString()}
                                  </span>
                                )}
                                {pr.deletions != null && (
                                  <span className="text-red-600 dark:text-red-400">
                                    -{pr.deletions.toLocaleString()}
                                  </span>
                                )}
                              </span>
                            </>
                          )}
                        </div>
                        {pr.reviewers && pr.reviewers.length > 0 && (
                          <div className="mt-1">
                            <ReviewersList reviewers={pr.reviewers} />
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
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
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            Review {labels.prNoun} in Emdash
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-0.5 px-1.5 text-muted-foreground"
                              onClick={() => window.electronAPI.openExternal(pr.url)}
                            >
                              {gitPlatform === 'gitlab' ? (
                                <Gitlab className="h-3.5 w-3.5" />
                              ) : (
                                <Github className="h-3.5 w-3.5" />
                              )}
                              <ArrowUpRight className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            Open this {labels.prNounFull.toLowerCase()} on{' '}
                            {gitPlatform === 'gitlab' ? 'GitLab' : 'GitHub'}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-full flex-1 items-center justify-center rounded-lg border border-dashed border-border/70 bg-muted/10 px-4 py-4">
                  <p className="text-center text-sm text-muted-foreground">
                    No open {labels.prNoun}s match this filter.
                  </p>
                </div>
              )}
            </div>

            {hasMore ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mx-auto h-8 gap-2 text-sm text-muted-foreground"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {loadingMore
                  ? `Loading ${labels.prNoun}s...`
                  : `Load more ${labels.prNoun}s (${prs.length}/${totalCount})`}
              </Button>
            ) : null}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
};

export default OpenPrsSection;
