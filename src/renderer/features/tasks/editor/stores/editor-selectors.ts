import { EditorTab } from '@renderer/lib/editor/types';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { EditorViewStore } from './editor-view-store';

export type RichEditorTab = EditorTab & { isDirty: boolean; bufferUri: string };

/** Returns true when the buffer for `filePath` has unsaved changes. */
export function selectTabIsDirty(store: EditorViewStore, filePath: string): boolean {
  return modelRegistry.dirtyUris.has(buildMonacoModelPath(store.modelRootPath, filePath));
}

/** Returns the currently active tab, or undefined if no tab is active. */
export function selectActiveTab(store: EditorViewStore): RichEditorTab | undefined {
  return store.activeTab;
}

/** Returns the current preview tab (single-click, not yet pinned), or undefined. */
export function selectPreviewTab(store: EditorViewStore): RichEditorTab | undefined {
  return store.previewTab;
}

/** Returns all tabs that have unsaved changes. */
export function selectDirtyTabs(store: EditorViewStore): RichEditorTab[] {
  return store.tabs.filter((t) => t.isDirty);
}
