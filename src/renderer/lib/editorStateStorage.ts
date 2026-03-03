export interface EditorState {
  expandedPaths: string[];
  openFilePaths: string[];
  activeFilePath: string | null;
  pinnedFiles?: string[];
}

const KEY_PREFIX = 'emdash:editorState:';

function getKey(taskId: string): string {
  return `${KEY_PREFIX}${taskId}`;
}

export function getEditorState(taskId: string | null): EditorState | null {
  if (!taskId) return null;
  try {
    const raw = localStorage.getItem(getKey(taskId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EditorState>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      expandedPaths: Array.isArray(parsed.expandedPaths) ? parsed.expandedPaths : [],
      openFilePaths: Array.isArray(parsed.openFilePaths) ? parsed.openFilePaths : [],
      activeFilePath:
        typeof parsed.activeFilePath === 'string' || parsed.activeFilePath === null
          ? parsed.activeFilePath
          : null,
      pinnedFiles: Array.isArray(parsed.pinnedFiles) ? parsed.pinnedFiles : [],
    };
  } catch {
    return null;
  }
}

export function saveEditorState(taskId: string | null, partial: Partial<EditorState>): void {
  if (!taskId) return;
  try {
    const existing = getEditorState(taskId) || {
      expandedPaths: [],
      openFilePaths: [],
      activeFilePath: null,
      pinnedFiles: [],
    };
    const next: EditorState = {
      expandedPaths:
        partial.expandedPaths !== undefined ? partial.expandedPaths : existing.expandedPaths,
      openFilePaths:
        partial.openFilePaths !== undefined ? partial.openFilePaths : existing.openFilePaths,
      activeFilePath:
        partial.activeFilePath !== undefined ? partial.activeFilePath : existing.activeFilePath,
      pinnedFiles: partial.pinnedFiles !== undefined ? partial.pinnedFiles : existing.pinnedFiles,
    };
    localStorage.setItem(getKey(taskId), JSON.stringify(next));
  } catch {
    // ignore
  }
}
