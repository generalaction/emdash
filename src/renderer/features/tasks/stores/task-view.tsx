import { computed, makeAutoObservable, reaction, runInAction } from 'mobx';
import type { ActiveFile, TaskViewSnapshot } from '@shared/view-state';
import type { ConversationManagerStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { DiffViewStore } from '@renderer/features/tasks/diff-view/stores/diff-view-store';
import type { GitStore } from '@renderer/features/tasks/diff-view/stores/git-store';
import { EditorViewStore } from '@renderer/features/tasks/editor/stores/editor-view-store';
import type { PrStore } from '@renderer/features/tasks/stores/pr-store';
import { TabManagerStore } from '@renderer/features/tasks/stores/tab-manager-store';
import type { TerminalManagerStore } from '@renderer/features/tasks/terminals/terminal-manager';
import { TerminalTabViewStore } from '@renderer/features/tasks/terminals/terminal-tab-view-store';
import { type SidebarTab } from '@renderer/features/tasks/types';
import { focusTracker } from '@renderer/utils/focus-tracker';

/**
 * Identifies which content renderer is active in the main panel.
 * - `'monaco'`      — persistent Monaco editor for plain text / code files
 * - `'markdown'`    — markdown files (preview or source; MarkdownEditorPanel owns both)
 * - `'diff'`        — git diff viewer
 * - `'agents'`      — conversation / PTY view
 * - `'other-file'`  — image, svg preview, binary, too-large
 */
export type RendererKind = 'monaco' | 'markdown' | 'diff' | 'agents' | 'other-file';

interface TaskViewResources {
  conversations: ConversationManagerStore;
  terminals: TerminalManagerStore;
  git: GitStore;
  pr: PrStore;
  projectId: string;
  workspaceId: string;
}

export class TaskViewStore {
  sidebarTab: SidebarTab;
  isSidebarCollapsed: boolean;
  focusedRegion: 'main' | 'bottom';
  isTerminalDrawerOpen: boolean;

  readonly tabManager: TabManagerStore;
  readonly terminalTabs: TerminalTabViewStore;
  readonly editorView: EditorViewStore;
  readonly diffView: DiffViewStore;
  private readonly terminalsMgr: TerminalManagerStore;
  private readonly disposers: (() => void)[] = [];

  constructor(resources: TaskViewResources, savedSnapshot?: TaskViewSnapshot) {
    this.sidebarTab = (savedSnapshot?.sidebarTab as SidebarTab) ?? 'conversations';
    this.isSidebarCollapsed = savedSnapshot?.isSidebarCollapsed ?? true;
    this.focusedRegion = savedSnapshot?.focusedRegion === 'bottom' ? 'bottom' : 'main';
    this.isTerminalDrawerOpen = savedSnapshot?.isTerminalDrawerOpen ?? false;
    this.terminalsMgr = resources.terminals;

    this.editorView = new EditorViewStore(resources.projectId, resources.workspaceId);
    this.tabManager = new TabManagerStore(resources.conversations, resources.workspaceId);
    this.terminalTabs = new TerminalTabViewStore(resources.terminals);
    this.diffView = new DiffViewStore(resources.git, resources.pr);

    // Restore tab state — prefer the new tabManager snapshot, fall back to legacy fields.
    if (savedSnapshot?.tabManager) {
      this.tabManager.restoreSnapshot(savedSnapshot.tabManager);
    } else if (savedSnapshot?.conversations?.tabOrder) {
      // Legacy restore: reconstruct from conversations + editor snapshots.
      const descriptors = savedSnapshot.conversations.tabOrder.map((id) => ({
        kind: 'conversation' as const,
        id,
        isPreview: false,
      }));
      this.tabManager.restoreSnapshot({
        tabs: [
          ...descriptors,
          ...(savedSnapshot.editor?.tabs?.map((t) => ({
            kind: 'file' as const,
            tabId: t.tabId,
            path: t.path,
            isPreview: t.isPreview,
          })) ?? []),
        ],
        activeTabId:
          savedSnapshot.conversations.activeTabId ??
          savedSnapshot.editor?.activeTabId ??
          undefined,
      });
    } else if (savedSnapshot?.editor?.tabs) {
      this.tabManager.restoreSnapshot({
        tabs: savedSnapshot.editor.tabs.map((t) => ({
          kind: 'file' as const,
          tabId: t.tabId,
          path: t.path,
          isPreview: t.isPreview,
        })),
        activeTabId: savedSnapshot.editor.activeTabId ?? undefined,
      });
    }

    if (savedSnapshot?.terminals) {
      this.terminalTabs.restoreSnapshot(savedSnapshot.terminals);
    }
    if (savedSnapshot?.editor) {
      this.editorView.restoreSnapshot(savedSnapshot.editor);
    }
    if (savedSnapshot?.diffView) {
      this.diffView.restoreSnapshot(savedSnapshot.diffView);
    }

    // Reactive model lifecycle: registers/unregisters Monaco models whenever the
    // set of open file paths changes. Covers initial mount (fireImmediately), tab
    // open/close, and in-place preview path mutation — no imperative calls needed.
    this.disposers.push(
      reaction(
        () => this.tabManager.openFilePaths,
        (current, previous = []) => {
          const prev = new Set(previous);
          const curr = new Set(current);
          for (const path of curr) {
            if (!prev.has(path)) {
              void this.editorView.registerModels(path).then((result) => {
                if (result?.imageContent !== undefined) {
                  runInAction(() => this.tabManager.setImageContent(path, result.imageContent!));
                }
              });
            }
          }
          for (const path of prev) {
            if (!curr.has(path)) this.editorView.unregisterModels(path);
          }
        },
        { fireImmediately: true }
      )
    );

    // Sync DiffViewStore.activeFile whenever the user activates a diff tab (e.g. clicking in the tab bar).
    this.disposers.push(
      reaction(
        () => {
          const desc = this.tabManager.activeDescriptor;
          return desc?.kind === 'diff' ? desc : null;
        },
        (tab) => {
          if (tab) {
            const activeFile: ActiveFile = {
              path: tab.path,
              type: tab.diffGroup === 'disk' ? 'disk' : 'git',
              group: tab.diffGroup,
              originalRef: tab.originalRef,
              modifiedRef: tab.modifiedRef,
              prNumber: tab.prNumber,
            };
            this.diffView.setActiveFile(activeFile);
          }
        }
      )
    );

    makeAutoObservable(this, {
      tabManager: false,
      terminalTabs: false,
      editorView: false,
      diffView: false,
      view: computed,
      activeRenderer: computed,
    });
  }

  get view(): 'agents' | 'editor' | 'diff' {
    const desc = this.tabManager.activeDescriptor;
    if (desc?.kind === 'diff') return 'diff';
    return desc?.kind === 'file' ? 'editor' : 'agents';
  }

  get activeRenderer(): RendererKind {
    const desc = this.tabManager.activeDescriptor;
    if (desc?.kind === 'diff') return 'diff';
    const tab = this.tabManager.activeFileTab;
    if (!tab) return 'agents';
    switch (tab.renderer.kind) {
      case 'text':
      case 'svg-source':
        return 'monaco';
      case 'markdown':
      case 'markdown-source':
        return 'markdown';
      default:
        return 'other-file'; // image, svg, binary, too-large
    }
  }

  get snapshot(): TaskViewSnapshot {
    return {
      view: this.view,
      sidebarTab: this.sidebarTab,
      isSidebarCollapsed: this.isSidebarCollapsed,
      focusedRegion: this.focusedRegion,
      isTerminalDrawerOpen: this.isTerminalDrawerOpen,
      tabManager: this.tabManager.snapshot,
      terminals: this.terminalTabs.snapshot,
      editor: this.editorView.snapshot,
      diffView: this.diffView.snapshot,
    };
  }

  setView(v: 'agents' | 'editor' | 'diff'): void {
    if (v === 'diff') {
      // Activate the most recently opened diff tab, if any.
      const diffTab = [...this.tabManager.tabs].reverse().find((t) => t.kind === 'diff');
      if (diffTab) {
        focusTracker.transition({ mainPanel: 'diff' }, 'panel_switch');
        this.tabManager.setActiveTab(diffTab.tabId);
      }
      return;
    }
    // 'agents' and 'editor' — active tab drives the renderer; no extra work needed.
    focusTracker.transition({ mainPanel: v }, 'panel_switch');
  }

  setSidebarTab(v: SidebarTab): void {
    this.sidebarTab = v;
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this.isSidebarCollapsed = collapsed;
  }

  setFocusedRegion(region: 'main' | 'bottom'): void {
    if (this.focusedRegion !== region) {
      focusTracker.transition({ focusedRegion: region }, 'region_switch');
    }
    this.focusedRegion = region;
  }

  setTerminalDrawerOpen(open: boolean): void {
    this.isTerminalDrawerOpen = open;
    if (open && this.terminalTabs.tabs.length === 0) {
      void this.terminalsMgr.createDefaultTerminal();
    }
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.tabManager.dispose();
    this.terminalTabs.dispose();
    this.editorView.dispose();
    this.diffView.dispose();
  }
}
