/** All possible states a file can be in once opened by the editor. */
export type ManagedFileKind =
  | 'text'
  | 'csv'
  | 'markdown'
  | 'html'
  | 'svg'
  | 'image'
  | 'too-large'
  | 'binary';
