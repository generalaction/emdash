import { FileRendererData } from '../tasks/types';

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
