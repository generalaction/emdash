import { useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import type * as monaco from 'monaco-editor';
import { MonacoCommentManager } from '../lib/MonacoCommentManager';
import { useLineComments } from './useLineComments';

interface UseDiffEditorCommentsOptions {
  editor: monaco.editor.IStandaloneDiffEditor | null;
  taskId: string;
  filePath: string;
}

export function useDiffEditorComments({ editor, taskId, filePath }: UseDiffEditorCommentsOptions) {
  const { comments, addComment, updateComment, deleteComment } = useLineComments(taskId, filePath, {
    includeSent: false,
  });
  const managerRef = useRef<MonacoCommentManager | null>(null);

  // Memoize callbacks to pass to manager
  const callbacks = useMemo(
    () => ({
      onAddComment: addComment,
      onEditComment: updateComment,
      onDeleteComment: deleteComment,
    }),
    [addComment, updateComment, deleteComment]
  );

  // Store comments in ref so we can access latest value in manager creation effect
  // useLayoutEffect runs synchronously after render but before other effects
  const commentsRef = useRef(comments);
  useLayoutEffect(() => {
    commentsRef.current = comments;
  });

  // Create manager when editor mounts
  useEffect(() => {
    if (!editor) return;

    const manager = new MonacoCommentManager(editor, {
      ...callbacks,
    });
    managerRef.current = manager;

    // Immediately apply current comments when manager is created
    manager.setComments(commentsRef.current);

    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, [editor, callbacks]);

  // Update comments in manager when they change
  useEffect(() => {
    managerRef.current?.setComments(comments);
  }, [comments]);

  return { comments };
}
