import { FileRendererData } from '@renderer/features/tasks/types';

/** All possible states a file can be in once opened by the editor. */
export type ManagedFileKind = 'text' | 'markdown' | 'svg' | 'image' | 'too-large' | 'binary';

/** A file that has been opened by the editor and is tracked in the task view store. */
export interface ManagedFile {
  path: string;
  kind: ManagedFileKind;
  /** Data-URL for images; empty string for Monaco-backed files (content lives in Monaco model). */
  content: string;
  /** True only for image files while the data-URL is being fetched. */
  isLoading: boolean;
  /** Only set for `kind === 'too-large'` files. */
  totalSize?: number | null;
  /** Stable UUID assigned once on first open — used as React key. */
  tabId: string;
  /** Renderer kind and its display state. */
  renderer: FileRendererData;
}

/**
 * A tab entry in the EditorViewStore tab list.
 * Extends ManagedFile with the isPreview flag so that a single-click preview
 * tab can be promoted to a stable tab without removing and re-adding it
 * (same tabId → same React key → no flash).
 */
export interface EditorTab extends ManagedFile {
  /** True when opened via single-click; double-click or an edit promotes it to stable. */
  isPreview: boolean;
}
