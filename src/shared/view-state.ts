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
  viewMode: 'stacked' | 'file';
  activeFile?: ActiveFile;
  commitAction: 'commit' | 'commit-push' | null;
};

export interface ActiveFile {
  path: string;
  type: 'disk' | 'staged' | 'git';
  originalRef: string;
  scrollBehavior?: 'smooth' | 'auto';
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
