import { computed, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import { DefaultConversationSeeder } from '@core/features/conversations/browser/default-conversation-seeder';
import { getDiffTabManager } from '@core/features/tasks/browser/diff-view/stores/diff-tab-manager';
import { DiffViewStore } from '@core/features/tasks/browser/diff-view/stores/diff-view-store';
import { EditorViewStore } from '@core/features/tasks/browser/editor/stores/editor-view-store';
import type { FileTabResource } from '@core/features/tasks/browser/editor/stores/file-tab-resource';
import { PreviewServerStore } from '@core/features/tasks/browser/stores/preview-server-store';
import { TerminalTabViewStore } from '@core/features/tasks/browser/terminals/terminal-tab-view-store';
import { type SidebarTab } from '@core/features/tasks/browser/types';
import {
  taskChromeMemento,
  taskDiffPreferencesMemento,
  taskDiffSelectionMemento,
  taskEditorTreeMemento,
  taskPaneLayoutMemento,
  taskTerminalSelectionMemento,
  type TaskChromeState,
  type TaskDiffPreferencesState,
  type TaskDiffSelectionState,
  type TaskTerminalSelectionState,
  type TerminalDrawerActiveItem,
} from '@core/features/tasks/contributions/mementos';
import { taskSubject } from '@core/features/tasks/contributions/subject';
import type { TaskTabContext } from '@core/features/workbench/browser/tabs/core/task-tab-context';
import { taskTabView } from '@core/features/workbench/browser/task-tab-registry';
import {
  sanitizedMemento,
  type MementoHandle,
  type SubjectSpace,
} from '@core/primitives/mementos/browser';
import type { Task } from '@core/primitives/tasks/api';
import type { TerminalShellId } from '@core/primitives/terminals/api';
import { getMementoClient } from '@renderer/lib/mementos';
import { appState } from '@renderer/lib/stores/app-state';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { log } from '@renderer/utils/logger';
import { PrStore } from './pr-store';
import type { TaskStore } from './task-store';
import { terminalRegistry } from './terminal-registry';
import { relativeToWorkspace, resolveWorkspacePath } from './workspace-path';
import { workspaceRegistry } from './workspace-registry';

export type RendererKind =
  | 'monaco'
  | 'markdown'
  | 'diff'
  | 'agents'
  | 'browser'
  | 'terminal'
  | 'other-file';

export class WorkspaceViewModel {
  focusedRegion: 'main' | 'bottom';
  readonly space: SubjectSpace<'task'>;

  /** Stable sub-stores — live for the full WorkspaceViewModel lifetime. */
  readonly paneLayout: ReturnType<typeof taskTabView.createPaneLayoutStore>;
  readonly terminalTabs: TerminalTabViewStore;
  readonly editorView: EditorViewStore;

  /**
   * Returns the focused pane's PaneStore.
   * Callers outside the split-pane render tree use this to access tab state
   * without needing to know about multiple panes.
   */
  get activePane(): ReturnType<typeof taskTabView.createPaneLayoutStore>['focusedPane'] {
    return this.paneLayout.focusedPane;
  }

  /**
   * Session-scoped: created in initialize() with live workspace git/pr references,
   * disposed and set to null in suspend().
   */
  diffView: DiffViewStore | null = null;
  prStore: PrStore | null = null;
  previewServers: PreviewServerStore | null = null;

  /** Permanent reactions (live as long as the view model). */
  private readonly _disposers: (() => void)[] = [];
  /** Session reactions (created in initialize, disposed in suspend). */
  private _sessionDisposers: (() => void)[] = [];

  private _isCreatingTerminal = false;
  private _paneHydrated = false;

  private readonly _seeder: DefaultConversationSeeder;
  private readonly _chromeHandle: MementoHandle<TaskChromeState>;
  private readonly _terminalSelectionHandle: MementoHandle<TaskTerminalSelectionState>;
  private readonly _diffPreferencesHandle: MementoHandle<TaskDiffPreferencesState>;
  private readonly _diffSelectionHandle: MementoHandle<TaskDiffSelectionState>;

  readonly taskId: string;

  constructor(private readonly _taskStore: TaskStore) {
    const taskData = _taskStore.data as Task;
    this.taskId = taskData.id;

    this.focusedRegion = 'main';
    this.space = getMementoClient().subject(taskSubject({ taskId: this.taskId }));
    this._chromeHandle = this.space.handle(taskChromeMemento);
    this._terminalSelectionHandle = sanitizedMemento(
      this.space.handle(taskTerminalSelectionMemento),
      {
        deps: () => {
          const terminals = terminalRegistry.get(this.taskId);
          return terminals?.isLoaded ? new Set(terminals.terminals.keys()) : undefined;
        },
        sanitize: sanitizeTerminalSelection,
      }
    );
    this._diffPreferencesHandle = this.space.handle(taskDiffPreferencesMemento);
    this._diffSelectionHandle = this.space.handle(taskDiffSelectionMemento);

    const workspaceId = taskData.workspaceId ?? taskData.id;
    const projectId = taskData.projectId;

    const taskCtx: TaskTabContext = {
      viewId: this.taskId,
      projectId,
      workspaceId,
      taskId: this.taskId,
      get workspacePath(): string | undefined {
        return workspaceRegistry.get(projectId, workspaceId)?.path;
      },
      modelRootPath: `workspace:${workspaceId}`,
      getRemoteConnectionId: () => this._workspace?.sshConnectionId,
      paneLayoutMemento: this.space.handle(taskPaneLayoutMemento),
    };
    this.paneLayout = taskTabView.createPaneLayoutStore(taskCtx, {
      onActiveTabChange: (tabId) => {
        if (!tabId) return;
        appState.history.push({
          kind: 'tab',
          projectId: taskData.projectId,
          taskId: this.taskId,
          tabId,
        });
      },
    });
    this._seeder = new DefaultConversationSeeder(this.taskId, this.paneLayout);
    this.terminalTabs = new TerminalTabViewStore(
      this._terminalSelectionHandle,
      () => terminalRegistry.get(this.taskId) ?? null
    );
    this.editorView = new EditorViewStore(
      this.paneLayout,
      taskData.projectId,
      workspaceId,
      this.space.handle(taskEditorTreeMemento)
    );

    makeAutoObservable<
      WorkspaceViewModel,
      | '_chromeHandle'
      | '_diffPreferencesHandle'
      | '_diffSelectionHandle'
      | '_terminalSelectionHandle'
    >(this, {
      paneLayout: false,
      terminalTabs: false,
      editorView: false,
      diffView: observable.ref,
      activeRenderer: computed,
      space: false,
      _chromeHandle: false,
      _terminalSelectionHandle: false,
      _diffPreferencesHandle: false,
      _diffSelectionHandle: false,
    });

    // Tell the engine whether this task is the active route so panes can
    // fire onActivate() correctly when the view becomes visible.
    this._disposers.push(
      reaction(
        () =>
          appState.navigation.currentViewId === 'task' &&
          (appState.navigation.viewParamsStore['task'] as { taskId?: string } | undefined)
            ?.taskId === this.taskId,
        (isActive) => this.paneLayout.setViewActive(isActive),
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

  get sidebarTab(): SidebarTab {
    return this._chromeHandle.value.sidebarTab;
  }

  get isSidebarCollapsed(): boolean {
    return this._chromeHandle.value.sidebarCollapsed;
  }

  get isTerminalDrawerOpen(): boolean {
    return this._chromeHandle.value.terminalDrawerOpen;
  }

  get terminalDrawerActiveItem(): TerminalDrawerActiveItem | undefined {
    return this._terminalSelectionHandle.value.activeItem;
  }

  get activeRenderer(): RendererKind {
    const desc = this.activePane.activeEntry;
    if (desc?.kind === 'diff') return 'diff';
    if (desc?.kind === 'browser') return 'browser';
    if (desc?.kind === 'terminal') return 'terminal';
    const resource = this.activePane.activeResourceOfKind<FileTabResource>('file');
    if (!resource) return 'agents';
    if (resource.contentType === 'markdown' && resource.viewMode === 'preview') return 'markdown';
    if (resource.contentType === 'text' || resource.viewMode === 'source') return 'monaco';
    return 'other-file';
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  hydrate(): void {
    if (this._paneHydrated) return;
    if (this.paneLayout.hydrate()) this._seeder.markConsumed(true);
    this._paneHydrated = true;
  }

  /**
   * Called when the task becomes provisioned. Creates session-scoped stores
   * (DiffViewStore, DiffTabLifecycleStore) and starts session-dependent reactions.
   */
  initialize(): void {
    if (this.previewServers) return;

    const workspace = this._workspace;
    if (!workspace) return; // defensive — should always have workspace when provisioned

    this.hydrate();

    const taskData = this._taskStore.data as Task;
    const workspaceId = this._taskStore.workspaceId!;
    this.previewServers = new PreviewServerStore({
      projectId: taskData.projectId,
      workspaceId,
      connectionId: workspace.sshConnectionId,
    });
    this.previewServers.start();
    this.prStore = new PrStore(
      taskData.projectId,
      workspaceId,
      workspace.gitRepository,
      workspace.gitCheckout,
      this._taskStore
    );

    const diffSelectionHandle = sanitizedMemento(this._diffSelectionHandle, {
      deps: () =>
        workspace.gitCheckout.hasData
          ? {
              workspacePath: workspace.path,
              validPaths: new Set([
                ...workspace.gitCheckout.unstagedFileChanges.map((file) => file.path),
                ...workspace.gitCheckout.stagedFileChanges.map((file) => file.path),
              ]),
            }
          : undefined,
      sanitize: sanitizeDiffSelection,
    });
    this.diffView = new DiffViewStore(
      workspace.gitCheckout,
      this.prStore,
      this._diffPreferencesHandle,
      diffSelectionHandle
    );

    getDiffTabManager(workspaceId).bindSession({
      gitCheckout: workspace.gitCheckout,
      pr: this.prStore,
      diffView: this.diffView,
    });

    this.paneLayout.startPersistence();

    // Open the default conversation tab only for fresh task views. If tab state was
    // restored, even an empty tab list represents the user's persisted choice.
    // This handles the optimistic-conversation case where conversations are already in
    // the manager before provision completes.
    this._seeder.seed();

    const closeEmptyTerminalDrawerDisposer = reaction(
      () => {
        const terminals = terminalRegistry.get(this.taskId);
        return {
          isDrawerOpen: this.isTerminalDrawerOpen,
          isCreatingTerminal: this._isCreatingTerminal,
          isLoaded: terminals?.isLoaded ?? false,
          terminalCount: terminals?.terminals.size ?? 0,
        };
      },
      (state, previous) => {
        if (
          state.isDrawerOpen &&
          !state.isCreatingTerminal &&
          state.isLoaded &&
          state.terminalCount === 0 &&
          (previous === undefined || previous.terminalCount > 0 || !previous.isLoaded)
        ) {
          runInAction(() => {
            this.setTerminalDrawerOpen(false);
            this._terminalSelectionHandle.update((current) => ({
              ...current,
              activeItem: undefined,
            }));
          });
        }
      },
      { fireImmediately: true }
    );
    this._sessionDisposers.push(closeEmptyTerminalDrawerDisposer);

    // Open this view's file-tree projection now that the workspace is provisioned.
    this.editorView.startFiles(workspace.path);

    const reconcileRegisteredScopesDisposer = reaction(
      () => {
        const files = this.editorView.files;
        if (!files) return '';
        const expanded = [...this.editorView.expandedPaths].sort().join('\0');
        const loaded = [...files.loadedPaths].sort().join('\0');
        const pending = [...files.pendingPaths].sort().join('\0');
        // `nodes.size` advances as scopes load, re-triggering progressive deep registration.
        return `${expanded}::${loaded}::${pending}::${files.nodes.size}`;
      },
      () => {
        const files = this.editorView.files;
        if (!files) return;
        files.reconcileVisibleScopes(this.editorView.expandedPaths);
      },
      { fireImmediately: true }
    );
    this._sessionDisposers.push(reconcileRegisteredScopesDisposer);
  }

  /**
   * Called when the task becomes unprovisioned. Persists the DiffView state and
   * tears down session-scoped stores and reactions. Stable state (tabs, sidebar)
   * is preserved so it survives re-provisioning.
   */
  suspend(): void {
    if (this.diffView) {
      this.diffView.dispose();
      this.diffView = null;
    }
    getDiffTabManager(this._taskStore.workspaceId!).unbindSession();
    this.prStore?.dispose();
    this.prStore = null;
    this.previewServers?.dispose();
    this.previewServers = null;

    this.paneLayout.stopPersistence();

    // Dispose session-scoped reactions before tearing down the projection they drive.
    for (const d of this._sessionDisposers) d();
    this._sessionDisposers = [];

    // Close this view's file-tree projection subscription.
    this.editorView.disposeFiles();
  }

  /**
   * Full teardown: suspend + dispose all permanent stores and reactions.
   * Call only when the task is being permanently removed.
   */
  dispose(): void {
    this.suspend();
    appState.history.prune((e) => e.kind === 'tab' && e.taskId === this.taskId);
    for (const d of this._disposers) d();
    this._seeder.dispose();
    this.paneLayout.dispose();
    this.terminalTabs.dispose();
    this.editorView.dispose();
    void this.space.release().catch((error: unknown) => getMementoClient().reportError(error));
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  activateLastTabOfKind(kind: 'conversation' | 'file' | 'diff' | 'browser' | 'terminal'): void {
    const tabId = [...this.activePane.tabOrder]
      .reverse()
      .find((id) => this.activePane.entries.get(id)?.kind === kind);
    if (!tabId) return;
    const panelView =
      kind === 'conversation'
        ? 'agents'
        : kind === 'file'
          ? 'editor'
          : kind === 'diff'
            ? 'diff'
            : kind === 'browser'
              ? 'browser'
              : 'terminal';
    focusTracker.transition({ mainPanel: panelView }, 'panel_switch');
    this.activePane.setActiveTab(tabId);
  }

  setSidebarTab(v: SidebarTab): void {
    this._chromeHandle.update((current) => ({ ...current, sidebarTab: v }));
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this._chromeHandle.update((current) => ({ ...current, sidebarCollapsed: collapsed }));
  }

  // Single source of truth for whether the changes panel is actually visible. TaskSidebar
  // hides it via ShowHide (display: none) based on this, and usePanelLayout must defer
  // imperative panel resizes to exactly the same condition (ENG-1559).
  get isChangesPanelVisible(): boolean {
    return !this.isSidebarCollapsed && this.sidebarTab === 'changes';
  }

  setFocusedRegion(region: 'main' | 'bottom'): void {
    if (this.focusedRegion !== region) {
      focusTracker.transition({ focusedRegion: region }, 'region_switch');
    }
    this.focusedRegion = region;
  }

  setTerminalDrawerOpen(open: boolean): void {
    this._chromeHandle.update((current) => ({ ...current, terminalDrawerOpen: open }));
    this.setFocusedRegion(open ? 'bottom' : 'main');
  }

  setTerminalDrawerActiveItem(item: TerminalDrawerActiveItem): void {
    this._terminalSelectionHandle.update((current) => ({ ...current, activeItem: item }));
  }

  /** Opens the terminal drawer and always creates a new terminal session. */
  async openNewTerminal(shell?: TerminalShellId): Promise<string | undefined> {
    this._chromeHandle.update((current) => ({ ...current, terminalDrawerOpen: true }));
    this.setFocusedRegion('bottom');

    const terminalId = await this._createDefaultTerminal(shell);
    if (!terminalId) return undefined;
    runInAction(() => {
      this.terminalTabs.setActiveTab(terminalId);
      this.setTerminalDrawerActiveItem({ kind: 'terminal', id: terminalId });
    });
    return terminalId;
  }

  private async _createDefaultTerminal(shell?: TerminalShellId): Promise<string | undefined> {
    if (this._isCreatingTerminal) return undefined;

    this._isCreatingTerminal = true;
    try {
      const terminal = await terminalRegistry.get(this.taskId)?.createDefaultTerminal(shell);
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
}

function sanitizeTerminalSelection(
  value: TaskTerminalSelectionState,
  terminalIds: ReadonlySet<string>
): TaskTerminalSelectionState {
  const tabOrder = value.tabOrder.filter((id) => terminalIds.has(id));
  const activeTabId =
    value.activeTabId && terminalIds.has(value.activeTabId) ? value.activeTabId : tabOrder[0];
  const activeItem =
    value.activeItem?.kind === 'terminal' && !terminalIds.has(value.activeItem.id)
      ? undefined
      : value.activeItem;
  return {
    ...value,
    tabOrder,
    activeTabId,
    activeItem,
  };
}

export function sanitizeDiffSelection(
  value: TaskDiffSelectionState,
  dependencies: { workspacePath: string; validPaths: ReadonlySet<string> }
): TaskDiffSelectionState {
  const activeFile = value.activeFile;
  if (!activeFile || activeFile.group === 'pr') return value;
  const relativePath = relativeToWorkspace(dependencies.workspacePath, activeFile.path);
  const path = resolveWorkspacePath(dependencies.workspacePath, activeFile.path);
  if (
    (activeFile.group === 'disk' || activeFile.group === 'staged') &&
    !dependencies.validPaths.has(relativePath)
  ) {
    return { ...value, activeFile: undefined };
  }
  return {
    ...value,
    activeFile: {
      ...activeFile,
      path,
    },
  };
}
