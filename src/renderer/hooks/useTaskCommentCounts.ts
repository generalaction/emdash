import { useState, useEffect, useCallback } from 'react';

/**
 * Hook to fetch comment counts per file for a task.
 * Returns a record mapping file paths to their comment counts.
 */
export function useTaskCommentCounts(taskId: string) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  const fetchCounts = useCallback(async () => {
    if (!taskId) {
      setCounts({});
      return;
    }

    try {
      const result = await window.electronAPI.lineCommentsGetUnsent(taskId);
      if (result.success && result.comments) {
        const countsByFile: Record<string, number> = {};
        for (const comment of result.comments) {
          countsByFile[comment.filePath] = (countsByFile[comment.filePath] || 0) + 1;
        }
        setCounts(countsByFile);
      }
    } catch {
      // Silently fail - counts will just show as 0
      setCounts({});
    }
  }, [taskId]);

  useEffect(() => {
    fetchCounts();
  }, [fetchCounts]);

  return { counts, refreshCounts: fetchCounts };
}
