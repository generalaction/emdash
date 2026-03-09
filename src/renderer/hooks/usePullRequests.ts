import { useCallback, useEffect, useState } from 'react';

export interface PullRequestSummary {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft?: boolean;
  updatedAt?: string | null;
  authorLogin?: string | null;
}

const DEFAULT_PAGE_SIZE = 10;

export function usePullRequests(
  projectPath?: string,
  enabled: boolean = true,
  pageSize: number = DEFAULT_PAGE_SIZE
) {
  const [prs, setPrs] = useState<PullRequestSummary[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedLimit, setLoadedLimit] = useState(pageSize);

  const fetchPrs = useCallback(
    async (limit: number, mode: 'reset' | 'load-more' = 'reset') => {
      if (!projectPath || !enabled) {
        setPrs([]);
        setTotalCount(0);
        setError(null);
        return;
      }

      if (mode === 'load-more') {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const response = await window.electronAPI.githubListPullRequests({ projectPath, limit });
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
        setError(err?.message || String(err));
        if (mode !== 'load-more') {
          setPrs([]);
          setTotalCount(0);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [projectPath, enabled]
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
  }, [pageSize, projectPath]);

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
    refresh,
    loadMore,
    hasMore: prs.length < totalCount,
  };
}
