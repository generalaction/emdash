import { computed, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import type { Task } from '@shared/tasks';
import type { DiffViewSnapshot, TaskViewSnapshot } from '@shared/view-state';
import { DiffTabLifecycleStore } from '@renderer/features/tasks/diff-view/stores/diff-tab-lifecycle-store';
import { DiffViewStore } from '@renderer/features/tasks/diff-view/stores/diff-view-store';
import { FileModelLifecycleStore } from '@renderer/features/tasks/editor/stores/file-model-lifecycle-store';
import { TabManagerStore } from '@renderer/features/tasks/tabs/tab-manager-store';
import { TerminalTabViewStore } from '@renderer/features/tasks/terminals/terminal-tab-view-store';
import { type SidebarTab } from '@renderer/features/tasks/types';
import { appState } from '@renderer/lib/stores/app-state';
import type { ILifecycle } from '@renderer/lib/stores/lifecycle';
import { snapshotRegistry } from '@renderer/lib/stores/snapshot-registry';
import { focusTracker } from '@renderer/utils/focus-tracker';
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

  /** Stable sub-stores — live for the full WorkspaceViewModel lifetime. */
  readonly tabManager: TabManagerStore;
  readonly terminalTabs: TerminalTabViewStore;
  readonly editorView: FileModelLifecycleStore;

  /**
   * Session-scoped: created in initialize() with live workspace git/pr references,
   * disposed and set to null in suspend().
   */
  diffView: DiffViewStore | null = null;
  prStore: PrStore | null = null;

  private _diffTabLifecycle: DiffTabLifecycleStore | null = null;

  /** Permanent reactions (live as long as the view model). */
  private readonly _disposers: (() => void)[] = [];
  /** Session reactions (created in initialize, disposed in suspend). */
  private _sessionDisposers: (() => void)[] = [];

  private _snapshotDisposer: (() => void) | null = null;
  /** Saved whenever suspend() is called, restored in next initialize(). */
  private _savedDiffViewSnapshot: DiffViewSnapshot | undefined;

  readonly taskId: string;

  constructor(private readonly _taskStore: TaskStore) {
    const taskData = _taskStore.data as Task;
    this.taskId = taskData.id;

    // UI state defaults — overridden by restoreSnapshot when called
    this.sidebarTab = 'conversations';
    this.isSidebarCollapsed = true;
    this.focusedRegion = 'main';
    this.isTerminalDrawerOpen = false;

    const workspaceId = taskData.workspaceId ?? taskData.id;

    this.tabManager = new TabManagerStore(
      () => conversationRegistry.get(this.taskId) ?? null,
      workspaceId
    );
    this.terminalTabs = new TerminalTabViewStore(() => terminalRegistry.get(this.taskId) ?? null);
    this.editorView = new FileModelLifecycleStore(this.tabManager, taskData.projectId, workspaceId);

    makeAutoObservable(this, {
      tabManager: false,
      terminalTabs: false,
      editorView: false,
      diffView: observable.ref,
      activeRenderer: computed,
    });

    // One-shot: open the initial conversation once conversations first become available.
    const initConvDisposer = reaction(
      () => conversationRegistry.get(this.taskId)?.conversations.size ?? 0,
      (size) => {
        if (size > 0 && this.tabManager.tabOrder.length === 0) {
          runInAction(() => this.tabManager.initializeDefault());
          initConvDisposer();
        }
      }
    );
    this._disposers.push(initConvDisposer);

    // Push tab-level history whenever the active tab changes.
    this._disposers.push(
      reaction(
        () => this.tabManager.resolvedActiveTabId,
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
    const attachment = this._taskStore.attachment;
    if (!attachment) return null;
    const projectId = (this._taskStore.data as Task).projectId;
    return workspaceRegistry.get(projectId, attachment.workspaceId) ?? null;
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
      tabManager: this.tabManager.snapshot,
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

    if (savedSnapshot.tabManager) {
      this.tabManager.restoreSnapshot(savedSnapshot.tabManager);
    } else if (savedSnapshot.conversations?.tabOrder?.length) {
      // Legacy migration: conversation tabs were stored under `conversations` before
      // the unified tab refactor.
      this.tabManager.restoreSnapshot({
        tabs: savedSnapshot.conversations.tabOrder.map((id) => ({
          kind: 'conversation' as const,
          tabId: crypto.randomUUID(),
          conversationId: id,
          isPreview: false,
        })),
        activeTabId: undefined,
      });
    }

    if (this.tabManager.tabOrder.length === 0) {
      this.tabManager.initializeDefault();
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

    const taskData = this._taskStore.data as Task;
    const workspaceId = this._taskStore.attachment!.workspaceId;
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
      this.tabManager,
      workspace.git,
      this.prStore,
      this.diffView
    );

    // Register snapshot with the persistence layer.
    this._snapshotDisposer = snapshotRegistry.register(`task:${this.taskId}`, () => this.snapshot);

    // Auto-create a terminal when the drawer is open and no terminals exist.
    const terminalsDisposer = reaction(
      () => {
        const terminals = terminalRegistry.get(this.taskId);
        return (
          this.isTerminalDrawerOpen &&
          (terminals?.isLoaded ?? false) &&
          this.terminalTabs.tabs.length === 0
        );
      },
      (shouldCreate) => {
        if (shouldCreate) void terminalRegistry.get(this.taskId)?.createDefaultTerminal();
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
    this.tabManager.dispose();
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

  /** Opens the terminal drawer and always creates a new terminal session. */
  openNewTerminal(): void {
    this.isTerminalDrawerOpen = true;
    this.setFocusedRegion('bottom');
    void terminalRegistry.get(this.taskId)?.createDefaultTerminal();
  }
}
