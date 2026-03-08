import { useCallback, useEffect, useState } from 'react';
import { rpc } from '../lib/ipc';

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

export function usePullRequests(projectPath?: string, enabled: boolean = true) {
  const [prs, setPrs] = useState<PullRequestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPrs = useCallback(async () => {
    if (!projectPath || !enabled) {
      setPrs([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await rpc.github.listPullRequests({ projectPath });
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
      } else {
        setError(response?.error || 'Failed to load pull requests');
        setPrs([]);
      }
    } catch (err: any) {
      setError(err?.message || String(err));
      setPrs([]);
    } finally {
      setLoading(false);
    }
  }, [projectPath, enabled]);

  useEffect(() => {
    if (!enabled) return;
    fetchPrs();
  }, [enabled, fetchPrs]);

  return { prs, loading, error, refresh: fetchPrs };
}
