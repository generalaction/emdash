import type {
  FileTabState,
  TabManagerStore,
} from '@renderer/features/tasks/stores/tab-manager-store';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';

export type RichFileTab = FileTabState & { isDirty: boolean; bufferUri: string };

/** Returns true when the buffer for `filePath` has unsaved changes. */
export function selectTabIsDirty(store: TabManagerStore, filePath: string): boolean {
  return modelRegistry.dirtyUris.has(buildMonacoModelPath(store.modelRootPath, filePath));
}

/** Returns the currently active file tab, or undefined if no file tab is active. */
export function selectActiveTab(store: TabManagerStore): RichFileTab | undefined {
  const tab = store.activeFileTab;
  if (!tab) return undefined;
  const bufferUri = buildMonacoModelPath(store.modelRootPath, tab.path);
  return { ...tab, isDirty: modelRegistry.dirtyUris.has(bufferUri), bufferUri };
}

/** Returns the current preview file tab (single-click, not yet pinned), or undefined. */
export function selectPreviewTab(store: TabManagerStore): RichFileTab | undefined {
  const tab = store.previewFileTab;
  if (!tab) return undefined;
  const bufferUri = buildMonacoModelPath(store.modelRootPath, tab.path);
  return { ...tab, isDirty: modelRegistry.dirtyUris.has(bufferUri), bufferUri };
}

/** Returns all file tabs that have unsaved changes. */
export function selectDirtyTabs(store: TabManagerStore): RichFileTab[] {
  return store.resolvedTabs
    .filter((t) => t.kind === 'file' && t.isDirty)
    .map((t) => {
      const tab = store.tabs.find(
        (s) => s.kind === 'file' && s.tabId === (t as { tabId: string }).tabId
      ) as FileTabState;
      return { ...tab, isDirty: true, bufferUri: (t as { bufferUri: string }).bufferUri };
    });
}
