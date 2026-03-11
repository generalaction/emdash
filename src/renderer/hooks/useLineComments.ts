import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { draftCommentsStore, type DraftComment } from '../lib/DraftCommentsStore';

export type { DraftComment };

export function useTaskComments(taskId?: string) {
  const resolvedTaskId = taskId ?? '';

  const comments = useSyncExternalStore(
    useCallback(
      (listener) => draftCommentsStore.subscribe(resolvedTaskId, listener),
      [resolvedTaskId]
    ),
    useCallback(() => draftCommentsStore.getSnapshot(resolvedTaskId), [resolvedTaskId]),
    useCallback(() => draftCommentsStore.getSnapshot(resolvedTaskId), [resolvedTaskId])
  );

  const count = comments.length;

  const add = useCallback(
    (comment: Omit<DraftComment, 'id' | 'taskId'>) =>
      draftCommentsStore.add(resolvedTaskId, comment),
    [resolvedTaskId]
  );

  const update = useCallback(
    (id: string, content: string) => draftCommentsStore.update(resolvedTaskId, id, content),
    [resolvedTaskId]
  );

  const remove = useCallback(
    (id: string) => draftCommentsStore.remove(resolvedTaskId, id),
    [resolvedTaskId]
  );

  const consumeAll = useCallback(
    () => draftCommentsStore.consumeAll(resolvedTaskId),
    [resolvedTaskId]
  );

  return { comments, count, add, update, remove, consumeAll };
}

export function useLineComments(taskId: string, filePath?: string) {
  const { comments: allComments, add, update, remove } = useTaskComments(taskId);

  const comments = useMemo(() => {
    if (!filePath) return [] as DraftComment[];
    return allComments.filter((c) => c.filePath === filePath);
  }, [filePath, allComments]);

  const addComment = useCallback(
    (lineNumber: number, content: string, lineContent?: string) => {
      if (!filePath) return;
      add({ filePath, lineNumber, lineContent: lineContent ?? '', content });
    },
    [add, filePath]
  );

  return {
    comments,
    addComment,
    updateComment: update,
    deleteComment: remove,
  };
}
