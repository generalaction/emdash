import type { GitObjectRef } from '@shared/git';

export type TabViewSnapshot = {
  tabOrder: string[];
  activeTabId: string | undefined;
};

export type EditorViewSnapshot = {
  tabs: Array<{ tabId: string; path: string; isPreview: boolean }>;
  activeTabId: string | null;
  expandedPaths: string[];
};

export type DiffViewSnapshot = {
  diffStyle: 'unified' | 'split';
  viewMode: 'file';
  activeFile?: ActiveFile;
  commitAction: 'commit' | 'commit-push' | null;
};

export interface ActiveFile {
  path: string;
  /** Storage layer: how content is fetched.
   *  'disk' = working-tree read (disk://)
   *  'git'  = git-object read (git://) */
  type: 'disk' | 'git';
  /** Semantic context: which diff panel/group this file belongs to.
   *  Determines which side is original/modified and which events make it stale.
   *  'disk'   = working tree vs HEAD
   *  'staged' = index vs HEAD
   *  'git'    = arbitrary ref-to-ref comparison
   *  'pr'     = PR diff (originalRef is remote-tracking base) */
  group: 'disk' | 'staged' | 'git' | 'pr';
  originalRef: GitObjectRef;
  /** Set only when group === 'pr'. Identifies the PR for store lookups. */
  prNumber?: number;
}

export type TaskViewSnapshot = {
  view: string | null;
  rightPanelView: string | null;
  focusedRegion: 'main' | 'right';
  conversations?: TabViewSnapshot;
  terminals?: TabViewSnapshot;
  editor?: EditorViewSnapshot;
  diffView?: DiffViewSnapshot;
};

export type ProjectViewSnapshot = {
  activeView: string;
  taskViewTab: 'active' | 'archived';
};

export type NavigationSnapshot = {
  currentViewId: string;
  viewParams: Record<string, unknown>;
};

export type SidebarTaskSortBy = 'created-at' | 'updated-at';

/** Persisted sidebar UI state; fields may be absent in older DB blobs. */
export type SidebarSnapshot = {
  expandedProjectIds?: string[];
  projectOrder?: string[];
  taskOrderByProject?: Record<string, string[]>;
  taskSortBy?: SidebarTaskSortBy;
};
