import { computed, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { DiffTabLifecycleStore } from '@renderer/features/tasks/diff-view/stores/diff-tab-lifecycle-store';
import { DiffViewStore } from '@renderer/features/tasks/diff-view/stores/diff-view-store';
import { FileModelLifecycleStore } from '@renderer/features/tasks/editor/stores/file-model-lifecycle-store';
import { DevServerStore } from '@renderer/features/tasks/stores/dev-server-store';
import { TabGroupManagerStore } from '@renderer/features/tasks/tabs/tab-group-manager-store';
import type { TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';
import { TerminalTabViewStore } from '@renderer/features/tasks/terminals/terminal-tab-view-store';
import { type SidebarTab } from '@renderer/features/tasks/types';
import { appState } from '@renderer/lib/stores/app-state';
import type { ILifecycle } from '@renderer/lib/stores/lifecycle';
import { snapshotRegistry } from '@renderer/lib/stores/snapshot-registry';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { log } from '@renderer/utils/logger';
import type { Task } from '@shared/tasks';
import type {
  DiffViewSnapshot,
  TaskViewSnapshot,
  TerminalDrawerActiveItem,
} from '@shared/view-state';
import { ConversationHydrationReconciler } from './conversation-hydration-reconciler';
import { conversationRegistry } from './conversation-registry';
import { PrStore } from './pr-store';
import type { TaskStore } from './task-store';
import { terminalRegistry } from './terminal-registry';
import { workspaceRegistry } from './workspace-registry';

// Re-export RendererKind for consumers that imported it from task-view
export type RendererKind = 'monaco' | 'markdown' | 'diff' | 'agents' | 'other-file';

export class WorkspaceViewModel implements ILifecycle {
  sidebarTab: SidebarTab;
  isSidebarCollapsed: boolean;
  focusedRegion: 'main' | 'bottom';
  isTerminalDrawerOpen: boolean;
  terminalDrawerActiveItem: TerminalDrawerActiveItem | undefined;

  /** Stable sub-stores — live for the full WorkspaceViewModel lifetime. */
  readonly tabGroupManager: TabGroupManagerStore;
  readonly terminalTabs: TerminalTabViewStore;
  readonly editorView: FileModelLifecycleStore;

  /**
   * Backwards-compatible getter returning the focused pane's TabManagerStore.
   * All callers outside the split-pane render tree use this to access tab state
   * without needing to know about multiple groups.
   */
  get tabManager(): TabManagerStore {
    return this.tabGroupManager.focusedGroup;
  }

  /**
   * Session-scoped: created in initialize() with live workspace git/pr references,
   * disposed and set to null in suspend().
   */
  diffView: DiffViewStore | null = null;
  prStore: PrStore | null = null;
  devServers: DevServerStore | null = null;

  private _diffTabLifecycle: DiffTabLifecycleStore | null = null;

  /** Permanent reactions (live as long as the view model). */
  private readonly _disposers: (() => void)[] = [];
  /** Session reactions (created in initialize, disposed in suspend). */
  private _sessionDisposers: (() => void)[] = [];

  private _snapshotDisposer: (() => void) | null = null;
  /** Saved whenever suspend() is called, restored in next initialize(). */
  private _savedDiffViewSnapshot: DiffViewSnapshot | undefined;
  private _isCreatingTerminal = false;
  private readonly _conversationHydration: ConversationHydrationReconciler;

  readonly taskId: string;

  constructor(private readonly _taskStore: TaskStore) {
    const taskData = _taskStore.data as Task;
    this.taskId = taskData.id;
    this._conversationHydration = new ConversationHydrationReconciler({
      taskId: this.taskId,
      getConversations: () => conversationRegistry.get(this.taskId),
      log,
    });

    // UI state defaults — overridden by restoreSnapshot when called
    this.sidebarTab = 'conversations';
    this.isSidebarCollapsed = true;
    this.focusedRegion = 'main';
    this.isTerminalDrawerOpen = false;
    this.terminalDrawerActiveItem = undefined;

    const workspaceId = taskData.workspaceId ?? taskData.id;

    this.tabGroupManager = new TabGroupManagerStore(
      () => conversationRegistry.get(this.taskId) ?? null,
      workspaceId
    );
    this.terminalTabs = new TerminalTabViewStore(() => terminalRegistry.get(this.taskId) ?? null);
    this.editorView = new FileModelLifecycleStore(
      this.tabGroupManager,
      taskData.projectId,
      workspaceId
    );

    makeAutoObservable<WorkspaceViewModel, '_conversationHydration'>(this, {
      tabGroupManager: false,
      terminalTabs: false,
      editorView: false,
      _conversationHydration: false,
      diffView: observable.ref,
      activeRenderer: computed,
    });

    // One-shot: open the initial conversation once conversations first become available.
    const initConvDisposer = reaction(
      () => conversationRegistry.get(this.taskId)?.conversations.size ?? 0,
      (size) => {
        if (size > 0 && this.tabGroupManager.focusedGroup.tabOrder.length === 0) {
          runInAction(() => this.tabGroupManager.focusedGroup.initializeDefault());
          initConvDisposer();
        }
      }
    );
    this._disposers.push(initConvDisposer);

    // Sync all panes' isVisible/isFocused with task active state and focused pane.
    // Tracks groupCount so new panes created via splitRight() are initialized immediately.
    this._disposers.push(
      reaction(
        () => {
          const isActive =
            appState.navigation.currentViewId === 'task' &&
            (appState.navigation.viewParamsStore['task'] as { taskId?: string } | undefined)
              ?.taskId === this.taskId;
          return {
            isActive,
            activeGroupId: this.tabGroupManager.activeGroupId,
            groupCount: this.tabGroupManager.groups.length,
          };
        },
        ({ isActive, activeGroupId }) => {
          for (const { groupId, tabManager } of this.tabGroupManager.groups) {
            tabManager.setVisible(isActive);
            tabManager.setFocused(isActive && groupId === activeGroupId);
          }
        },
        { fireImmediately: true }
      )
    );

    // Push tab-level history whenever the focused group's active tab changes.
    this._disposers.push(
      reaction(
        () => this.tabGroupManager.focusedGroup.resolvedActiveTabId,
        (tabId) => {
          if (!tabId) return;
          appState.history.push({
            kind: 'tab',
            projectId: (this._taskStore.data as Task).projectId,
            taskId: this.taskId,
            tabId,
          });
        },
        { fireImmediately: true }
      )
    );
  }

  private get _workspace() {
    const workspaceId = this._taskStore.workspaceId;
    if (!workspaceId) return null;
    const projectId = (this._taskStore.data as Task).projectId;
    return workspaceRegistry.get(projectId, workspaceId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Computed
  // -------------------------------------------------------------------------

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
        return 'other-file';
    }
  }

  get snapshot(): TaskViewSnapshot {
    return {
      sidebarTab: this.sidebarTab,
      isSidebarCollapsed: this.isSidebarCollapsed,
      focusedRegion: this.focusedRegion,
      isTerminalDrawerOpen: this.isTerminalDrawerOpen,
      terminalDrawerActiveItem: this.terminalDrawerActiveItem,
      tabGroups: this.tabGroupManager.snapshot,
      terminals: this.terminalTabs.snapshot,
      editor: this.editorView.snapshot,
      diffView: this.diffView?.snapshot ?? this._savedDiffViewSnapshot,
    };
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Restore persisted UI state from a saved snapshot. Call this before
   * initialize() so the reaction baseline is correct.
   */
  restoreSnapshot(savedSnapshot: TaskViewSnapshot): void {
    this.sidebarTab = (savedSnapshot.sidebarTab as SidebarTab) ?? 'conversations';
    this.isSidebarCollapsed = savedSnapshot.isSidebarCollapsed ?? true;
    this.focusedRegion = savedSnapshot.focusedRegion === 'bottom' ? 'bottom' : 'main';
    this.isTerminalDrawerOpen = savedSnapshot.isTerminalDrawerOpen ?? false;
    this.terminalDrawerActiveItem = savedSnapshot.terminalDrawerActiveItem;

    if (savedSnapshot.tabGroups) {
      // Current format: multi-group snapshot.
      this.tabGroupManager.restoreSnapshot(savedSnapshot.tabGroups);
    } else if (savedSnapshot.tabManager) {
      // Legacy migration: single-pane tabManager snapshot from before split panes.
      this.tabGroupManager.restoreSnapshot({
        groups: [{ groupId: crypto.randomUUID(), tabManager: savedSnapshot.tabManager }],
        activeGroupId: '',
        paneSizes: [100],
      });
    } else if (savedSnapshot.conversations?.tabOrder?.length) {
      // Legacy migration: conversation tabs were stored under `conversations` before
      // the unified tab refactor.
      this.tabGroupManager.restoreSnapshot({
        groups: [
          {
            groupId: crypto.randomUUID(),
            tabManager: {
              tabs: savedSnapshot.conversations.tabOrder.map((id) => ({
                kind: 'conversation' as const,
                tabId: crypto.randomUUID(),
                conversationId: id,
                isPreview: false,
              })),
              activeTabId: undefined,
            },
          },
        ],
        activeGroupId: '',
        paneSizes: [100],
      });
    }

    if (this.tabGroupManager.focusedGroup.tabOrder.length === 0) {
      this.tabGroupManager.focusedGroup.initializeDefault();
    }

    if (savedSnapshot.terminals) {
      this.terminalTabs.restoreSnapshot(savedSnapshot.terminals);
    }
    if (savedSnapshot.editor) {
      this.editorView.restoreSnapshot(savedSnapshot.editor);
    }
    if (savedSnapshot.diffView) {
      this._savedDiffViewSnapshot = savedSnapshot.diffView;
    }
  }

  /**
   * Called when the task becomes provisioned. Creates session-scoped stores
   * (DiffViewStore, DiffTabLifecycleStore) and starts session-dependent reactions.
   */
  initialize(): void {
    if (this._snapshotDisposer) return; // already active

    const workspace = this._workspace;
    if (!workspace) return; // defensive — should always have workspace when provisioned

    this._conversationHydration.resume();

    const taskData = this._taskStore.data as Task;
    const workspaceId = this._taskStore.workspaceId!;
    this.devServers = new DevServerStore(this.taskId, workspaceId);
    this.prStore = new PrStore(
      taskData.projectId,
      workspaceId,
      workspace.repository,
      this._taskStore
    );

    // Create DiffViewStore with live git/pr references from the workspace.
    this.diffView = new DiffViewStore(workspace.git, this.prStore);
    if (this._savedDiffViewSnapshot) {
      this.diffView.restoreSnapshot(this._savedDiffViewSnapshot);
    }

    this._diffTabLifecycle = new DiffTabLifecycleStore(
      this.tabGroupManager.focusedGroup,
      workspace.git,
      this.prStore,
      this.diffView
    );

    // Register snapshot with the persistence layer.
    this._snapshotDisposer = snapshotRegistry.register(`task:${this.taskId}`, () => this.snapshot);

    const conversationHydrationDisposer = reaction(
      () => this.openConversationIds,
      (ids) => this.syncConversationHydration(ids),
      { fireImmediately: true }
    );
    this._sessionDisposers.push(conversationHydrationDisposer);

    // Auto-create a terminal when the drawer is open and no terminals exist.
    const terminalsDisposer = reaction(
      () => {
        const terminals = terminalRegistry.get(this.taskId);
        return (
          this.isTerminalDrawerOpen &&
          !this._isCreatingTerminal &&
          (terminals?.isLoaded ?? false) &&
          this.terminalTabs.tabs.length === 0
        );
      },
      (shouldCreate) => {
        if (shouldCreate) void this._createDefaultTerminal();
      }
    );
    this._sessionDisposers.push(terminalsDisposer);
  }

  /**
   * Called when the task becomes unprovisioned. Persists the DiffView state and
   * tears down session-scoped stores and reactions. Stable state (tabs, sidebar)
   * is preserved so it survives re-provisioning.
   */
  suspend(): void {
    // Persist DiffView state before disposing.
    if (this.diffView) {
      this._savedDiffViewSnapshot = this.diffView.snapshot;
      this.diffView.dispose();
      this.diffView = null;
    }
    this._diffTabLifecycle?.dispose();
    this._diffTabLifecycle = null;
    this.prStore?.dispose();
    this.prStore = null;
    this.devServers?.dispose();
    this.devServers = null;

    this._conversationHydration.dispose();

    // Stop snapshot persistence.
    this._snapshotDisposer?.();
    this._snapshotDisposer = null;

    // Dispose session-scoped reactions.
    for (const d of this._sessionDisposers) d();
    this._sessionDisposers = [];
  }

  /**
   * Full teardown: suspend + dispose all permanent stores and reactions.
   * Call only when the task is being permanently removed.
   */
  dispose(): void {
    this.suspend();
    appState.history.prune((e) => e.kind === 'tab' && e.taskId === this.taskId);
    for (const d of this._disposers) d();
    this.tabGroupManager.dispose();
    this.terminalTabs.dispose();
    this.editorView.dispose();
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

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
    this.setFocusedRegion(open ? 'bottom' : 'main');
  }

  setTerminalDrawerActiveItem(item: TerminalDrawerActiveItem): void {
    this.terminalDrawerActiveItem = item;
  }

  /** Opens the terminal drawer and always creates a new terminal session. */
  async openNewTerminal(): Promise<string | undefined> {
    this.isTerminalDrawerOpen = true;
    this.setFocusedRegion('bottom');

    const terminalId = await this._createDefaultTerminal();
    if (!terminalId) return undefined;
    runInAction(() => {
      this.terminalTabs.setActiveTab(terminalId);
      this.terminalDrawerActiveItem = { kind: 'terminal', id: terminalId };
    });
    return terminalId;
  }

  private async _createDefaultTerminal(): Promise<string | undefined> {
    if (this._isCreatingTerminal) return undefined;

    this._isCreatingTerminal = true;
    try {
      const terminal = await terminalRegistry.get(this.taskId)?.createDefaultTerminal();
      if (!terminal) return undefined;
      return terminal.id;
    } catch (error) {
      log.error('Failed to create terminal:', error);
      return undefined;
    } finally {
      runInAction(() => {
        this._isCreatingTerminal = false;
      });
    }
  }

  private get openConversationIds(): string[] {
    const ids = new Set<string>();
    for (const { tabManager } of this.tabGroupManager.groups) {
      for (const tabId of tabManager.tabOrder) {
        const entry = tabManager.entries.get(tabId);
        if (entry?.kind === 'conversation') ids.add(entry.conversationId);
      }
    }
    return [...ids].sort();
  }

  private syncConversationHydration(openIds: string[]): void {
    this._conversationHydration.sync(openIds);
  }
}
