import { useCallback } from 'react';
import { taskViewStateStore } from '@renderer/core/tasks/view/task-view-store';
import { useEditorContext } from '@renderer/views/tasks/editor/editor-provider';
import { FileRendererData } from '../tasks/types';

/**
 * Gives any component direct read+write access to its `ManagedFile` entry in
 * the task view store.
 *
 * - `openedFile` — the current file entry (renderer kind + display state).
 * - `updateRenderer` — functional updater that patches the renderer data for
 *   this file directly via an observable action.
 */
export function useOpenedFile(filePath: string) {
  const { taskId } = useEditorContext();
  const editorView = taskViewStateStore.getOrCreate(taskId).editorView;

  const openedFile = editorView.openFiles.get(filePath);

  const updateRenderer = useCallback(
    (updater: (prev: FileRendererData) => FileRendererData) => {
      editorView.updateRenderer(filePath, updater);
    },
    [editorView, filePath]
  );

  return { openedFile, updateRenderer };
}
