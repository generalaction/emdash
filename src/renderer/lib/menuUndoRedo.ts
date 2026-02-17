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

export function handleMenuUndo(): void {
  if (performActiveEditorUndo()) return;
  void performNativeEditableUndo('undo');
}

export function handleMenuRedo(): void {
  if (performActiveEditorRedo()) return;
  void performNativeEditableUndo('redo');
}
