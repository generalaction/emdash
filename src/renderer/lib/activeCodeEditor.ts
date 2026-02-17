let activeEditor: any | null = null;

function isEditorFocused(editor: any): boolean {
  if (!editor) return false;

  try {
    if (typeof editor.hasTextFocus === 'function' && editor.hasTextFocus()) return true;
  } catch {}

  try {
    if (typeof editor.hasWidgetFocus === 'function' && editor.hasWidgetFocus()) return true;
  } catch {}

  return false;
}

export function registerActiveCodeEditor(editor: any): () => void {
  if (!editor) return () => {};

  const focusDisposable = editor.onDidFocusEditorText?.(() => {
    activeEditor = editor;
  });

  // If the editor starts focused, capture immediately.
  if (isEditorFocused(editor)) {
    activeEditor = editor;
  }

  return () => {
    try {
      focusDisposable?.dispose?.();
    } catch {}
    if (activeEditor === editor) {
      activeEditor = null;
    }
  };
}

export function performActiveEditorUndo(): boolean {
  const editor = activeEditor;
  if (!editor || !isEditorFocused(editor)) return false;
  try {
    editor.trigger('menu', 'undo', null);
    return true;
  } catch {
    return false;
  }
}

export function performActiveEditorRedo(): boolean {
  const editor = activeEditor;
  if (!editor || !isEditorFocused(editor)) return false;
  try {
    editor.trigger('menu', 'redo', null);
    return true;
  } catch {
    return false;
  }
}
