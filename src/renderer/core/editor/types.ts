/** All possible states a file can be in once opened by the editor. */
export type ManagedFileKind = 'text' | 'svg' | 'image' | 'too-large' | 'binary';

/** A file that has been opened by the editor and is tracked in React state. */
export interface ManagedFile {
  path: string;
  kind: ManagedFileKind;
  /** Raw content or data-URL (images). Empty string while loading or for binary files. */
  content: string;
  isLoading: boolean;
  /** Only set for `kind === 'too-large'` files. */
  totalSize?: number | null;
}
