export type TabViewSnapshot = {
  tabOrder: string[];
  activeTabId: string | undefined;
};

export type EditorViewSnapshot = {
  tabs: Array<{ tabId: string; path: string; isPreview: boolean }>;
  activeTabId: string | null;
  expandedPaths: string[];
};

export type TaskViewSnapshot = {
  view: string | null;
  rightPanelView: string | null;
  focusedRegion: 'main' | 'right';
  conversations?: TabViewSnapshot;
  terminals?: TabViewSnapshot;
  editor?: EditorViewSnapshot;
};

export type ProjectViewSnapshot = {
  activeView: string;
  taskViewTab: 'active' | 'archived';
};

export type NavigationSnapshot = {
  currentViewId: string;
  viewParams: Record<string, unknown>;
};
