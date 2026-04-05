import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GitPlatformListPullRequestsResult,
  GitPlatformPullRequestReviewer,
  GitPlatformPullRequestSummary,
} from '../../shared/git/platform';
import { normalizePullRequestSearchQuery } from '../lib/pullRequestFilters';

export type PullRequestReviewer = GitPlatformPullRequestReviewer;

export type PullRequestSummary = Omit<GitPlatformPullRequestSummary, 'author'> & {
  authorLogin?: string | null;
};

const DEFAULT_PAGE_SIZE = 10;

export function usePullRequests(
  projectPath?: string,
  enabled: boolean = true,
  pageSize: number = DEFAULT_PAGE_SIZE,
  searchQuery?: string
) {
  const normalizedSearchQuery = normalizePullRequestSearchQuery(searchQuery);
  const [prs, setPrs] = useState<PullRequestSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedLimit, setLoadedLimit] = useState(pageSize);
  const [hasFetched, setHasFetched] = useState(false);
  const requestIdRef = useRef(0);

  const fetchPrs = useCallback(
    async (limit: number, mode: 'reset' | 'load-more' = 'reset') => {
      if (!projectPath || !enabled) {
        setPrs([]);
        setTotalCount(0);
        setError(null);
        return;
      }

      const requestId = ++requestIdRef.current;

      if (mode === 'load-more') {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const response: GitPlatformListPullRequestsResult =
          await window.electronAPI.gitPlatformListPullRequests({
            projectPath,
            limit,
            searchQuery: normalizedSearchQuery || undefined,
          });
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (response?.success) {
          const items = Array.isArray(response.prs) ? response.prs : [];
          const mapped = items
            .map((item: any) => ({
              number: Number(item?.number) || 0,
              title: String(item?.title || `PR #${item?.number ?? 'unknown'}`),
              headRefName: String(item?.headRefName || ''),
              baseRefName: String(item?.baseRefName || ''),
              url: String(item?.url || ''),
              isDraft: !!item?.isDraft,
              updatedAt: item?.updatedAt ? String(item.updatedAt) : null,
              authorLogin:
                typeof item?.author === 'object' && item?.author
                  ? String(item.author.login || item.author.name || '')
                  : null,
              reviewDecision: item?.reviewDecision || null,
              reviewers: Array.isArray(item?.reviewers) ? item.reviewers : [],
              additions: typeof item?.additions === 'number' ? item.additions : undefined,
              deletions: typeof item?.deletions === 'number' ? item.deletions : undefined,
              checksStatus: item?.checksStatus ?? null,
            }))
            .filter((item) => item.number > 0);
          setPrs(mapped);
          setTotalCount(Number(response.totalCount) || mapped.length);
          setLoadedLimit(limit);
        } else {
          setError(response?.error || 'Failed to load pull requests');
          if (mode !== 'load-more') {
            setPrs([]);
            setTotalCount(0);
          }
        }
      } catch (err: any) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setError(err?.message || String(err));
        if (mode !== 'load-more') {
          setPrs([]);
          setTotalCount(0);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setHasFetched(true);
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [projectPath, enabled, normalizedSearchQuery]
  );

  const refresh = useCallback(async () => {
    await fetchPrs(pageSize, 'reset');
  }, [fetchPrs, pageSize]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || prs.length >= totalCount) return;
    await fetchPrs(loadedLimit + pageSize, 'load-more');
  }, [fetchPrs, loadedLimit, loading, loadingMore, pageSize, prs.length, totalCount]);

  useEffect(() => {
    setLoadedLimit(pageSize);
  }, [pageSize, projectPath, normalizedSearchQuery]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh]);

  return {
    prs,
    totalCount,
    loading,
    loadingMore,
    error,
    hasFetched,
    refresh,
    loadMore,
    hasMore: prs.length < totalCount,
  };
}
