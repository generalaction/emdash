import { performActiveEditorRedo, performActiveEditorUndo } from './activeCodeEditor';

function runAfterFocusRestores(action: () => void): void {
  // Native menu clicks can transiently blur the editor/input while the menu is open.
  // Run one frame later so focus has a chance to return before dispatching undo/redo.
  requestAnimationFrame(() => {
    action();
  });
}

export function handleMenuUndo(): void {
  runAfterFocusRestores(() => {
    if (performActiveEditorUndo()) return;
    void window.electronAPI.undo();
  });
}

export function handleMenuRedo(): void {
  runAfterFocusRestores(() => {
    if (performActiveEditorRedo()) return;
    void window.electronAPI.redo();
  });
}
