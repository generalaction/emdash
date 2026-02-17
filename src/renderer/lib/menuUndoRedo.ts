import { performActiveEditorRedo, performActiveEditorUndo } from './activeCodeEditor';

function isUndoableEditableTarget(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tagName = target.tagName;
  if (tagName === 'TEXTAREA') return true;

  if (tagName === 'INPUT') {
    const input = target as HTMLInputElement;
    const type = (input.type || 'text').toLowerCase();
    const nonTextTypes = new Set([
      'button',
      'checkbox',
      'color',
      'file',
      'hidden',
      'image',
      'radio',
      'range',
      'reset',
      'submit',
    ]);
    return !nonTextTypes.has(type);
  }

  return false;
}

function performNativeEditableUndo(command: 'undo' | 'redo'): boolean {
  const active = document.activeElement;
  if (!isUndoableEditableTarget(active)) return false;
  return document.execCommand(command);
}

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
    void performNativeEditableUndo('undo');
  });
}

export function handleMenuRedo(): void {
  runAfterFocusRestores(() => {
    if (performActiveEditorRedo()) return;
    void performNativeEditableUndo('redo');
  });
}
