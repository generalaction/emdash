import { useCallback } from 'react';
import {
  useTaskViewState,
  type FileRendererData,
} from '@renderer/core/tasks/task-view-state-provider';
import { useEditorContext } from '@renderer/views/tasks/editor/editor-provider';

/**
 * Gives any component direct read+write access to its `OpenedFile` entry in
 * `TaskViewStateProvider`.
 *
 * - `openedFile` — the current persisted entry (renderer kind + display state).
 * - `updateRenderer` — functional updater that patches the renderer data for
 *   this file and writes it back to `TaskViewStateProvider`.
 */
export function useOpenedFile(filePath: string) {
  const { taskId } = useEditorContext();
  const { getTaskViewState, setTaskViewState } = useTaskViewState();

  const openedFile = getTaskViewState(taskId).editorView.openedFiles.find(
    (f) => f.path === filePath
  );

  const updateRenderer = useCallback(
    (updater: (prev: FileRendererData) => FileRendererData) => {
      const { editorView } = getTaskViewState(taskId);
      setTaskViewState(taskId, {
        editorView: {
          ...editorView,
          openedFiles: editorView.openedFiles.map((f) =>
            f.path === filePath ? { ...f, renderer: updater(f.renderer) } : f
          ),
        },
      });
    },
    [taskId, filePath, getTaskViewState, setTaskViewState]
  );

  return { openedFile, updateRenderer };
}
