import { useTaskComments } from './useLineComments';

/**
 * Hook to fetch unsent comment counts per file for a task.
 */
export function useTaskCommentCounts(taskId: string) {
  const { countsByFile, refresh } = useTaskComments(taskId);
  return { counts: countsByFile, refreshCounts: refresh };
}
