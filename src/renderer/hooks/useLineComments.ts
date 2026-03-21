import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  buildCommentScopeKey,
  draftCommentsStore,
  type DraftComment,
} from '../lib/DraftCommentsStore';

export type { DraftComment };

export function useTaskComments(taskId?: string, taskPath?: string | null) {
  const scopeKey = buildCommentScopeKey(taskId, taskPath);

  const comments = useSyncExternalStore(
    useCallback((listener) => draftCommentsStore.subscribe(scopeKey, listener), [scopeKey]),
    useCallback(() => draftCommentsStore.getSnapshot(scopeKey), [scopeKey]),
    useCallback(() => draftCommentsStore.getSnapshot(scopeKey), [scopeKey])
  );

  const count = comments.length;

  const add = useCallback(
    (comment: Omit<DraftComment, 'id' | 'taskId'>) => draftCommentsStore.add(scopeKey, comment),
    [scopeKey]
  );

  const update = useCallback(
    (id: string, content: string) => draftCommentsStore.update(scopeKey, id, content),
    [scopeKey]
  );

  const remove = useCallback((id: string) => draftCommentsStore.remove(scopeKey, id), [scopeKey]);

  const consumeAll = useCallback(() => draftCommentsStore.consumeAll(scopeKey), [scopeKey]);

  return { comments, count, add, update, remove, consumeAll };
}

export function useLineComments(taskId: string, filePath?: string, taskPath?: string | null) {
  const { comments: allComments, add, update, remove } = useTaskComments(taskId, taskPath);

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
