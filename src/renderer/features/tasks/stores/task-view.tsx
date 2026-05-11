import { computed, makeAutoObservable, reaction } from 'mobx';
import type { TaskViewSnapshot } from '@shared/view-state';
import type { ConversationManagerStore } from '@renderer/features/tasks/conversations/conversation-manager';
import { DiffTabLifecycleStore } from '@renderer/features/tasks/diff-view/stores/diff-tab-lifecycle-store';
import { DiffViewStore } from '@renderer/features/tasks/diff-view/stores/diff-view-store';
import type { GitStore } from '@renderer/features/tasks/diff-view/stores/git-store';
import { FileModelLifecycleStore } from '@renderer/features/tasks/editor/stores/file-model-lifecycle-store';
import type { PrStore } from '@renderer/features/tasks/stores/pr-store';
import { TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';
import type { TerminalManagerStore } from '@renderer/features/tasks/terminals/terminal-manager';
import { TerminalTabViewStore } from '@renderer/features/tasks/terminals/terminal-tab-view-store';
import { type SidebarTab } from '@renderer/features/tasks/types';
import { appState } from '@renderer/lib/stores/app-state';
import { focusTracker } from '@renderer/utils/focus-tracker';

/**
 * Identifies which content renderer is active in the main panel.
 * - `'monaco'`      — persistent Monaco editor for plain text / code files
 * - `'markdown'`    — markdown files (preview or source; MarkdownEditorPanel owns both)
 * - `'diff'`        — git diff viewer
 * - `'agents'`      — conversation / PTY view
 * - `'other-file'`  — image, svg preview, binary, too-large, file-error
 */
export type RendererKind = 'monaco' | 'markdown' | 'diff' | 'agents' | 'other-file';

interface TaskViewResources {
  conversations: ConversationManagerStore;
  terminals: TerminalManagerStore;
  git: GitStore;
  pr: PrStore;
  projectId: string;
  taskId: string;
  workspaceId: string;
}

export class TaskViewStore {
  sidebarTab: SidebarTab;
  isSidebarCollapsed: boolean;
  focusedRegion: 'main' | 'bottom';
  isTerminalDrawerOpen: boolean;

  readonly tabManager: TabManagerStore;
  readonly terminalTabs: TerminalTabViewStore;
  readonly editorView: FileModelLifecycleStore;
  readonly diffView: DiffViewStore;
  private readonly diffTabLifecycle: DiffTabLifecycleStore;
  private readonly terminalsMgr: TerminalManagerStore;
  private readonly disposers: (() => void)[] = [];
  private readonly taskId: string;

  constructor(resources: TaskViewResources, savedSnapshot?: TaskViewSnapshot) {
    this.taskId = resources.taskId;
    this.sidebarTab = (savedSnapshot?.sidebarTab as SidebarTab) ?? 'conversations';
    this.isSidebarCollapsed = savedSnapshot?.isSidebarCollapsed ?? true;
    this.focusedRegion = savedSnapshot?.focusedRegion === 'bottom' ? 'bottom' : 'main';
    this.isTerminalDrawerOpen = savedSnapshot?.isTerminalDrawerOpen ?? false;
    this.terminalsMgr = resources.terminals;

    this.tabManager = new TabManagerStore(resources.conversations, resources.workspaceId);
    this.terminalTabs = new TerminalTabViewStore(resources.terminals);
    this.diffView = new DiffViewStore(resources.git, resources.pr);

    // Restore tab state from the unified tabManager snapshot.
    if (savedSnapshot?.tabManager) {
      this.tabManager.restoreSnapshot(savedSnapshot.tabManager);
    } else if (savedSnapshot?.conversations?.tabOrder?.length) {
      // Legacy migration: old blobs stored conversation tabs under a separate
      // `conversations` field before the unified tab refactor. Reconstruct a
      // TabManagerSnapshot so existing open conversations are preserved.
      this.tabManager.restoreSnapshot({
        tabs: savedSnapshot.conversations.tabOrder.map((id) => ({
          kind: 'conversation' as const,
          tabId: crypto.randomUUID(),
          conversationId: id,
          isPreview: false,
        })),
        activeTabId: undefined,
      });
    } else {
      // No saved snapshot — brand-new task view. Open any conversation marked as
      // the initial conversation so it appears as a tab by default.
      this.tabManager.initializeDefault();
    }

    // Create FileModelLifecycleStore after tab snapshot restore so the initial
    // model registration fires with the correct set of open file paths.
    this.editorView = new FileModelLifecycleStore(
      this.tabManager,
      resources.projectId,
      resources.workspaceId
    );

    if (savedSnapshot?.terminals) {
      this.terminalTabs.restoreSnapshot(savedSnapshot.terminals);
    }
    if (savedSnapshot?.editor) {
      this.editorView.restoreSnapshot(savedSnapshot.editor);
    }
    if (savedSnapshot?.diffView) {
      this.diffView.restoreSnapshot(savedSnapshot.diffView);
    }

    // Diff tab lifecycle: syncs DiffViewStore and auto-closes stale diff tabs.
    this.diffTabLifecycle = new DiffTabLifecycleStore(
      this.tabManager,
      resources.git,
      resources.pr,
      this.diffView
    );

    // Push tab-level history entries whenever the active tab changes.
    // fireImmediately captures the initial tab when the store is first constructed.
    this.disposers.push(
      reaction(
        () => this.tabManager.resolvedActiveTabId,
        (tabId) => {
          if (!tabId) return;
          appState.history.push({
            kind: 'tab',
            projectId: resources.projectId,
            taskId: resources.taskId,
            tabId,
          });
        },
        { fireImmediately: true }
      )
    );

    makeAutoObservable(this, {
      tabManager: false,
      terminalTabs: false,
      editorView: false,
      diffView: false,
      activeRenderer: computed,
    });
  }

  get activeRenderer(): RendererKind {
    const desc = this.tabManager.activeDescriptor;
    if (desc?.kind === 'diff') return 'diff';
    const tab = this.tabManager.activeFileEntry;
    if (!tab) return 'agents';
    switch (tab.renderer.kind) {
      case 'text':
      case 'svg-source':
      case 'html-source':
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

  activateLastTabOfKind(kind: 'conversation' | 'file' | 'diff'): void {
    const tabId = [...this.tabManager.tabOrder]
      .reverse()
      .find((id) => this.tabManager.entries.get(id)?.kind === kind);
    if (!tabId) return;
    const panelView = kind === 'conversation' ? 'agents' : kind === 'file' ? 'editor' : 'diff';
    focusTracker.transition({ mainPanel: panelView }, 'panel_switch');
    this.tabManager.setActiveTab(tabId);
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

  /** Opens the terminal drawer and always creates a new terminal session. */
  openNewTerminal(): void {
    this.isTerminalDrawerOpen = true;
    void this.terminalsMgr.createDefaultTerminal();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    // Remove any tab history entries for this task so back/forward doesn't
    // navigate to a task that no longer has an active view.
    appState.history.prune((e) => e.kind === 'tab' && e.taskId === this.taskId);
    this.tabManager.dispose();
    this.terminalTabs.dispose();
    this.editorView.dispose();
    this.diffTabLifecycle.dispose();
    this.diffView.dispose();
  }
}
