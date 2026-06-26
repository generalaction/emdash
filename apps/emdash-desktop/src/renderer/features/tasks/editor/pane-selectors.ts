/**
 * Pane selectors for the editor domain.
 *
 * These helpers let editor code read file-tab state from a generic PaneStore /
 * PaneLayoutStore without the engine having to know about FileTabStore.
 */
import type { PaneLayoutStore } from '@renderer/features/tabs/pane-layout-store';
import type { PaneStore } from '@renderer/features/tabs/pane-store';
import type { FileTabStore } from '@renderer/features/tasks/editor/stores/file-tab-store';

export function activeFileEntry(pane: PaneStore): FileTabStore | undefined {
  return pane.activeEntryOfKind<FileTabStore>('file');
}

export function fileEntryByPath(pane: PaneStore, path: string): FileTabStore | undefined {
  return pane.entriesOfKind<FileTabStore>('file').find((e) => e.path === path);
}

export function activeFilePath(pane: PaneStore): string | null {
  return activeFileEntry(pane)?.path ?? null;
}

/** All open non-external file tab paths for a single pane, in tab-order. */
export function openFilePaths(pane: PaneStore): string[] {
  return pane
    .entriesOfKind<FileTabStore>('file')
    .filter((e) => !e.isExternal)
    .map((e) => e.path);
}

/** Union of open file paths across all panes (de-duplicated). */
export function allOpenFilePaths(paneLayout: PaneLayoutStore): string[] {
  const seen = new Set<string>();
  for (const { pane } of paneLayout.groups) {
    for (const path of openFilePaths(pane)) {
      seen.add(path);
    }
  }
  return [...seen];
}
