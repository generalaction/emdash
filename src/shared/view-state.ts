import type { GitObjectRef } from '@shared/git';

export type TabViewSnapshot = {
  tabOrder: string[];
  activeTabId: string | undefined;
};

export type TabDescriptor =
  | { kind: 'conversation'; id: string; isPreview: boolean }
  | { kind: 'file'; tabId: string; path: string; isPreview: boolean };

export type TabManagerSnapshot = {
  tabs: TabDescriptor[];
  activeTabId: string | undefined;
};

export type EditorViewSnapshot = {
  /** Legacy: was used before tab state moved to TabManagerSnapshot. Ignored on restore. */
  tabs?: Array<{ tabId: string; path: string; isPreview: boolean }>;
  /** Legacy: was used before tab state moved to TabManagerSnapshot. Ignored on restore. */
  activeTabId?: string | null;
  expandedPaths: string[];
};

export type DiffViewSnapshot = {
  diffStyle: 'unified' | 'split';
  viewMode: 'file';
  activeFile?: ActiveFile;
  commitAction: 'commit' | 'commit-push' | null;
  prTab?: 'files' | 'commits' | 'checks';
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
  /** PR head SHA for the modified side of a 'pr' group diff.
   *  When absent the diff stack falls back to HEAD_REF. */
  modifiedRef?: GitObjectRef;
  /** Set only when group === 'pr'. Identifies the PR for store lookups. */
  prNumber?: number;
}

export type TaskViewSnapshot = {
  view: string | null;
  sidebarTab?: string;
  isSidebarCollapsed?: boolean;
  focusedRegion: 'main' | 'bottom';
  isTerminalDrawerOpen?: boolean;
  /** New unified tab manager snapshot. Takes precedence over legacy fields when present. */
  tabManager?: TabManagerSnapshot;
  /** Legacy: kept for backward-compat restore. */
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
