import type * as monaco from 'monaco-editor';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { AiAnnotation } from '@core/features/source-control/api/browser/diff-view/stores/ai-annotations-store';
import type { DraftComment } from '@core/features/source-control/api/browser/diff-view/stores/draft-comments-store';
import { MonacoCommentManager } from './monaco-comment-manager';

const NO_ANNOTATIONS: readonly AiAnnotation[] = [];

interface UseDiffEditorCommentsOptions {
  editor: monaco.editor.IStandaloneDiffEditor | null;
  comments: DraftComment[];
  onAddComment: (lineNumber: number, content: string, lineContent?: string) => void | Promise<void>;
  onEditComment: (id: string, content: string) => void | Promise<void>;
  onDeleteComment: (id: string) => void | Promise<void>;
  annotations?: readonly AiAnnotation[];
  onDismissAnnotation?: (id: string) => void;
}

export function useDiffEditorComments({
  editor,
  comments,
  onAddComment,
  onEditComment,
  onDeleteComment,
  annotations = NO_ANNOTATIONS,
  onDismissAnnotation,
}: UseDiffEditorCommentsOptions): void {
  const managerRef = useRef<MonacoCommentManager | null>(null);

  const callbacks = useMemo(
    () => ({
      onAddComment,
      onEditComment,
      onDeleteComment,
      onDismissAnnotation,
    }),
    [onAddComment, onEditComment, onDeleteComment, onDismissAnnotation]
  );

  const commentsRef = useRef(comments);
  const annotationsRef = useRef(annotations);
  useLayoutEffect(() => {
    commentsRef.current = comments;
    annotationsRef.current = annotations;
  });

  useEffect(() => {
    if (!editor) return;

    const manager = new MonacoCommentManager(editor, callbacks);
    managerRef.current = manager;
    manager.setComments(commentsRef.current);
    manager.setAnnotations(annotationsRef.current);

    return () => {
      manager.dispose();
      managerRef.current = null;
    };
  }, [editor, callbacks]);

  useEffect(() => {
    managerRef.current?.setComments(comments);
  }, [comments]);

  useEffect(() => {
    managerRef.current?.setAnnotations(annotations);
  }, [annotations]);
}
