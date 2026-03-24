import { ManagedFile } from '../editor/types';

export type MainPanelView = 'agents' | 'editor' | 'diff';
export type RightPanelView = 'changes' | 'files' | 'terminals';

export type FileRendererData =
  | { kind: 'text' }
  | { kind: 'markdown' }
  | { kind: 'markdown-source' }
  | { kind: 'svg' }
  | { kind: 'svg-source' }
  | { kind: 'image' }
  | { kind: 'binary' }
  | { kind: 'too-large' };

export type OpenedFile = {
  /** Stable UUID assigned once on first open — used as React key. */
  tabId: string;
  /** Worktree-relative file path (e.g. `src/components/App.tsx`). Not a Monaco URI. */
  path: string;
  /** Renderer kind — determines which component renders this file. */
  renderer: FileRendererData;
};

/** Input shape for EditorViewState.setFile — tabId is managed by the store. */
export type ManagedFileInput = Omit<ManagedFile, 'tabId'>;
