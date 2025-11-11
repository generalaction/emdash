import { useCallback, useEffect, useState } from 'react';

export interface CommitHistoryEntry {
  sha: string;
  shortSha: string;
  summary: string;
  relativeDate?: string;
  date?: string;
  authorName?: string;
}

export function useCommitHistory(workspacePath: string, limit = 12) {
  const [commits, setCommits] = useState<CommitHistoryEntry[]>([]);
  const [branch, setBranch] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(
    async (showLoading = false) => {
      if (!workspacePath) return;
      if (showLoading) setIsLoading(true);

      try {
        const result = await window.electronAPI.getCommitHistory({ workspacePath, limit });
        if (result?.success) {
          setCommits(result.commits ?? []);
          setBranch(result.branch || '');
          setError(null);
        } else {
          setCommits([]);
          setBranch('');
          setError(result?.error || 'Failed to load commit history');
        }
      } catch (err) {
        console.error('Failed to fetch commit history:', err);
        setCommits([]);
        setBranch('');
        setError('Failed to load commit history');
      } finally {
        if (showLoading) setIsLoading(false);
      }
    },
    [workspacePath, limit]
  );

  useEffect(() => {
    fetchHistory(true);
    if (!workspacePath) return;
    const interval = setInterval(() => fetchHistory(false), 15000);
    return () => clearInterval(interval);
  }, [workspacePath, fetchHistory]);

  return {
    commits,
    branch,
    isLoading,
    error,
    refresh: () => fetchHistory(true),
  };
}
