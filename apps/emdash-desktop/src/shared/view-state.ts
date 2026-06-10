import type { BrowserSessionSnapshot } from '@shared/browser';
import type { GitChangeStatus, GitObjectRef } from '@shared/core/git/git';

export type TabViewSnapshot = {
  tabOrder: string[];
  activeTabId: string | undefined;
};

export type TabDescriptor =
  | { kind: 'conversation'; tabId: string; conversationId: string; isPreview: boolean }
  | { kind: 'file'; tabId: string; path: string; isPreview: boolean; isExternal?: boolean }
  | {
      kind: 'browser';
      tabId: string;
      browserId: string;
      session: BrowserSessionSnapshot;
      isPreview: boolean;
    }
  | {
      kind: 'diff';
      tabId: string;
      path: string;
      diffGroup: 'disk' | 'staged' | 'git' | 'pr' | 'unified';
      originalRef: GitObjectRef;
      modifiedRef?: GitObjectRef;
      prNumber?: number;
      prBaseOid?: string;
      prHeadOid?: string;
      commitOriginalSha?: string | null;
      commitModifiedSha?: string;
      status?: GitChangeStatus;
      isPreview: boolean;
    };

export type TabManagerSnapshot = {
  tabs: TabDescriptor[];
  activeTabId: string | undefined;
};

export type TabGroupsSnapshot = {
  groups: Array<{
    groupId: string;
    tabManager: TabManagerSnapshot;
  }>;
  activeGroupId: string;
  /** Percentage sizes parallel to groups[]. */
  paneSizes: number[];
};

export type EditorViewSnapshot = {
  /** Legacy: was used before tab state moved to TabManagerSnapshot. Ignored on restore. */
  tabs?: Array<{ tabId: string; path: string; isPreview: boolean; isExternal?: boolean }>;
  /** Legacy: was used before tab state moved to TabManagerSnapshot. Ignored on restore. */
  activeTabId?: string | null;
  expandedPaths: string[];
};

export type DiffViewSnapshot = {
  diffStyle: 'unified' | 'split';
  viewMode: 'file';
  activeFile?: ActiveFile;
  commitAction: 'commit' | 'commit-push' | 'commit-pr' | null;
  prTab?: 'files' | 'commits' | 'checks';
};

export type TerminalDrawerActiveItem =
  | { kind: 'terminal'; id: string }
  | { kind: 'script'; id: string };

export interface ActiveFile {
  path: string;
  /** Storage layer: how content is fetched.
   *  'disk' = working-tree read (disk://)
   *  'git'  = git-object read (git://) */
  type: 'disk' | 'git';
  /** Semantic context: which diff panel/group this file belongs to.
   *  Determines which side is original/modified and which events make it stale.
   *  'disk'    = working tree vs HEAD
   *  'staged'  = index vs HEAD
   *  'git'     = arbitrary ref-to-ref comparison
   *  'pr'      = PR diff (originalRef is remote-tracking base)
   *  'unified' = working tree vs merge-base of (PR base | default branch) and HEAD */
  group: 'disk' | 'staged' | 'git' | 'pr' | 'unified';
  originalRef: GitObjectRef;
  /** Fixed modified-side ref for 'git' and 'pr' diffs.
   *  When absent the diff viewer falls back to HEAD_REF. */
  modifiedRef?: GitObjectRef;
  /** Set only when group === 'pr'. Identifies the PR for store lookups. */
  prNumber?: number;
  /** Exact PR base/head OIDs for comment scoping and stable target identity. */
  prBaseOid?: string;
  prHeadOid?: string;
  /** Exact commit diff endpoints for comment scoping. Root commits use null original. */
  commitOriginalSha?: string | null;
  commitModifiedSha?: string;
}

export type TaskViewSnapshot = {
  sidebarTab?: string;
  isSidebarCollapsed?: boolean;
  focusedRegion: 'main' | 'bottom';
  isTerminalDrawerOpen?: boolean;
  terminalDrawerActiveItem?: TerminalDrawerActiveItem;
  /** Takes precedence over tabManager when present. */
  tabGroups?: TabGroupsSnapshot;
  /** @deprecated Use tabGroups. Kept for migration from single-pane snapshots. */
  tabManager?: TabManagerSnapshot;
  /** @deprecated Legacy field from before the unified tab refactor. Used only for migration. */
  conversations?: TabViewSnapshot;
  terminals?: TabViewSnapshot;
  editor?: EditorViewSnapshot;
  diffView?: DiffViewSnapshot;
};

export type ProjectViewSnapshot = {
  activeView: string;
  taskViewTab: 'active' | 'archived';
  selectedIssueProvider?: string;
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
