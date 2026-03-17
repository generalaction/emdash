import { useCallback, useEffect, useState } from 'react';
import { rpc } from '../core/ipc';

export interface PullRequestSummary {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  authorLogin: string | null;
}

export function usePullRequests(nameWithOwner?: string, enabled: boolean = true) {
  const [prs, setPrs] = useState<PullRequestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPrs = useCallback(async () => {
    if (!nameWithOwner || !enabled) {
      setPrs([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await rpc.github.listPullRequests(nameWithOwner);
      if (response?.success) {
        const items = Array.isArray(response.prs) ? response.prs : [];
        const mapped: PullRequestSummary[] = items
          .map((item) => ({
            number: Number(item.number) || 0,
            title: String(item.title || `PR #${item.number ?? 'unknown'}`),
            headRefName: String(item.headRefName || ''),
            baseRefName: String(item.baseRefName || ''),
            url: String(item.url || ''),
            isDraft: !!item.isDraft,
            updatedAt: String(item.updatedAt || ''),
            authorLogin: item.author?.login ?? null,
          }))
          .filter((item) => item.number > 0);
        setPrs(mapped);
      } else {
        setError(response?.error || 'Failed to load pull requests');
        setPrs([]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setPrs([]);
    } finally {
      setLoading(false);
    }
  }, [nameWithOwner, enabled]);

  useEffect(() => {
    if (!enabled) return;
    fetchPrs();
  }, [enabled, fetchPrs]);

  return { prs, loading, error, refresh: fetchPrs };
}
