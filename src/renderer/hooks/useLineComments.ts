import { useState, useEffect, useCallback } from 'react';

interface LineComment {
  id: string;
  taskId: string;
  filePath: string;
  lineNumber: number;
  lineContent?: string | null;
  side: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string | null;
}

// Custom event for syncing comment changes across components
export const LINE_COMMENTS_CHANGED_EVENT = 'line-comments-changed';

export function dispatchCommentsChanged(taskId: string) {
  window.dispatchEvent(
    new CustomEvent(LINE_COMMENTS_CHANGED_EVENT, { detail: { taskId } })
  );
}

export function useLineComments(
  taskId: string,
  filePath?: string,
  opts?: { includeSent?: boolean }
) {
  const [comments, setComments] = useState<LineComment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const includeSent = opts?.includeSent ?? true;

  const fetchComments = useCallback(async () => {
    if (!taskId) return;

    try {
      const result = await window.electronAPI.lineCommentsGet({ taskId, filePath });
      if (result.success && result.comments) {
        const next = includeSent
          ? result.comments
          : result.comments.filter((comment) => !comment.sentAt);
        setComments(next);
        setError(null);
      } else {
        setError(result.error ?? 'Failed to load comments');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [taskId, filePath, includeSent]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  useEffect(() => {
    const handleCommentsChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.taskId === taskId) {
        fetchComments();
      }
    };

    window.addEventListener(LINE_COMMENTS_CHANGED_EVENT, handleCommentsChanged);
    return () => {
      window.removeEventListener(LINE_COMMENTS_CHANGED_EVENT, handleCommentsChanged);
    };
  }, [taskId, fetchComments]);

  const addComment = useCallback(
    async (
      lineNumber: number,
      side: 'original' | 'modified',
      content: string,
      lineContent?: string
    ) => {
      if (!taskId || !filePath) return null;

      const result = await window.electronAPI.lineCommentsCreate({
        taskId,
        filePath,
        lineNumber,
        lineContent,
        side,
        content,
      });

      if (result.success) {
        await fetchComments();
        dispatchCommentsChanged(taskId);
        return result.id;
      }
      return null;
    },
    [taskId, filePath, fetchComments]
  );

  const updateComment = useCallback(
    async (id: string, content: string) => {
      const result = await window.electronAPI.lineCommentsUpdate({ id, content });
      if (result.success) {
        await fetchComments();
        dispatchCommentsChanged(taskId);
        return true;
      }
      return false;
    },
    [taskId, fetchComments]
  );

  const deleteComment = useCallback(
    async (id: string) => {
      const result = await window.electronAPI.lineCommentsDelete(id);
      if (result.success) {
        await fetchComments();
        dispatchCommentsChanged(taskId);
        return true;
      }
      return false;
    },
    [taskId, fetchComments]
  );

  return {
    comments,
    isLoading,
    error,
    addComment,
    updateComment,
    deleteComment,
    refreshComments: fetchComments,
  };
}
