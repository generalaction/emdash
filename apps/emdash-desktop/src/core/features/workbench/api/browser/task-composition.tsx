import type { TerminalShellId } from '@emdash/core/primitives/terminal-shell/api';
import { computed, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import type { ConversationManagerStore } from '@core/features/conversations/api/browser/conversation-manager';
import { EditorViewStore } from '@core/features/editor/api/browser/task-editor/stores/editor-view-store';
import type { FileTabResource } from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import { DiffViewStore } from '@core/features/source-control/api/browser/diff-view/stores/diff-view-store';
import type { GitRepositoryStore } from '@core/features/source-control/api/browser/stores/git-repository-store';
import { PrStore } from '@core/features/source-control/api/browser/stores/pr-store';
import {
  diffTabManagerStoreToken,
  gitCheckoutStoreToken,
} from '@core/features/source-control/contributions/browser/workspace-store-tokens';
import { PreviewServerStore } from '@core/features/tasks/api/browser/stores/preview-server-store';
import { TaskNavigationParticipant } from '@core/features/tasks/api/browser/stores/task-navigation-participant';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { type SidebarTab } from '@core/features/tasks/api/browser/types';
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
  type TaskPaneLayoutState,
  type TaskTerminalSelectionState,
  type TerminalDrawerActiveItem,
} from '@core/features/tasks/contributions/mementos';
import { taskSubject } from '@core/features/tasks/contributions/subject';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { TerminalManagerStore } from '@core/features/terminals/api/browser/task-terminal/terminal-manager';
import { TerminalTabViewStore } from '@core/features/terminals/api/browser/task-terminal/terminal-tab-view-store';
import type { TaskTabContext } from '@core/features/workbench/api/browser/tabs/task-tab-context';
import { taskTabView } from '@core/features/workbench/api/browser/task-tab-registry';
import type { WorkspaceStore } from '@core/features/workspaces/api/browser/stores/workspace';
import { workspaceRegistry } from '@core/features/workspaces/api/browser/stores/workspace-registry';
import {
  sanitizedMemento,
  type MementoHandle,
  type SubjectSpace,
} from '@core/primitives/mementos/browser';
import { getMementoClient } from '@core/primitives/mementos/browser';
import { appState } from '@renderer/lib/stores/app-state';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { log } from '@renderer/utils/logger';
import { sanitizeDiffSelection } from '../../browser/task-composition-state';

export type RendererKind =
  | 'monaco'
  | 'markdown'
  | 'diff'
  | 'agents'
  | 'browser'
  | 'terminal'
  | 'other-file';

/**
 * Workbench-owned composition boundary for a task view.
 *
 * Task identity is joined to workspace-scoped stores only here. Feature state is
 * resolved through scoped-store tokens and task-tab providers rather than being
 * attached to TaskStore.
 */
export class TaskComposition {
  focusedRegion: 'main' | 'bottom';
  readonly space: SubjectSpace<'task'>;
  readonly paneLayout: ReturnType<typeof taskTabView.createPaneLayoutStore>;
  readonly terminalTabs: TerminalTabViewStore;
  readonly editorView: EditorViewStore;

  get activePane(): ReturnType<typeof taskTabView.createPaneLayoutStore>['focusedPane'] {
    return this.paneLayout.focusedPane;
  }

  diffView: DiffViewStore | null = null;
  prStore: PrStore | null = null;
  previewServers: PreviewServerStore | null = null;

  private readonly _disposers: (() => void)[] = [];
  private _sessionDisposers: (() => void)[] = [];
  private _workspace: WorkspaceStore | null = null;
  private _acquiredWorkspaceId: string | null = null;
  private _activated = false;
  private _isCreatingTerminal = false;
  private _paneHydrated = false;
  private _initializing = false;

  private readonly _chromeHandle: MementoHandle<TaskChromeState>;
  private readonly _terminalSelectionHandle: MementoHandle<TaskTerminalSelectionState>;
  private readonly _diffPreferencesHandle: MementoHandle<TaskDiffPreferencesState>;
  private readonly _diffSelectionHandle: MementoHandle<TaskDiffSelectionState>;

  constructor(
    readonly projectId: string,
    readonly taskId: string,
    private readonly _taskStore: TaskStore,
    private readonly _terminals: TerminalManagerStore,
    private readonly _conversations: ConversationManagerStore,
    private readonly _gitRepository: GitRepositoryStore
  ) {
    this.focusedRegion = 'main';
    this.space = getMementoClient().subject(taskSubject({ taskId }));
    this._chromeHandle = this.space.handle(taskChromeMemento);
    this._terminalSelectionHandle = sanitizedMemento(
      this.space.handle(taskTerminalSelectionMemento),
      {
        deps: () =>
          this._terminals.isLoaded ? new Set(this._terminals.terminals.keys()) : undefined,
        sanitize: sanitizeTerminalSelection,
      }
    );
    this._diffPreferencesHandle = this.space.handle(taskDiffPreferencesMemento);
    this._diffSelectionHandle = this.space.handle(taskDiffSelectionMemento);

    const taskData = _taskStore.data;
    const workspaceId = ('workspaceId' in taskData && taskData.workspaceId) || taskId;
    const taskRef = taskViewDef({ projectId, taskId });
    const getWorkspacePath = () => this._workspace?.path;
    const paneLayoutMemento = sanitizedMemento(this.space.handle(taskPaneLayoutMemento), {
      deps: () =>
        this._conversations.list.data
          ? new Set(this._conversations.conversations.keys())
          : undefined,
      sanitize: sanitizePaneLayoutConversations,
    });
    const taskCtx: TaskTabContext = {
      viewId: taskId,
      projectId,
      workspaceId,
      taskId,
      get workspacePath(): string | undefined {
        return getWorkspacePath();
      },
      modelRootPath: `workspace:${workspaceId}`,
      getRemoteConnectionId: () => this._workspace?.sshConnectionId,
      paneLayoutMemento,
    };
    this.paneLayout = taskTabView.createPaneLayoutStore(taskCtx, {
      onActiveTabChange: (tabId) => {
        if (tabId) appState.navigation.reportLocation(taskRef, { tabId });
      },
    });
    this._disposers.push(
      appState.navigation.attachParticipant(taskRef, new TaskNavigationParticipant(this.paneLayout))
    );
    this.terminalTabs = new TerminalTabViewStore(
      this._terminalSelectionHandle,
      () => this._terminals
    );
    this.editorView = new EditorViewStore(
      this.paneLayout,
      projectId,
      workspaceId,
      this.space.handle(taskEditorTreeMemento)
    );

    makeAutoObservable<
      TaskComposition,
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

    this._disposers.push(
      reaction(
        () =>
          appState.navigation.currentRef.viewId === 'task' &&
          (appState.navigation.currentRef.params as { taskId?: string }).taskId === taskId,
        (isActive) => this.paneLayout.setViewActive(isActive),
        { fireImmediately: true }
      ),
      reaction(
        () => ({
          state: this._taskStore.state,
          workspaceId: this._taskStore.workspaceId,
          path: this._taskStore.workspacePath,
          sshConnectionId: this._taskStore.workspaceSshConnectionId,
        }),
        () => this.syncWorkspace(),
        { fireImmediately: true }
      )
    );
  }

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

  get workspace(): WorkspaceStore | null {
    return this._workspace;
  }

  private async hydrateAndSeedPaneLayout(): Promise<void> {
    if (this._paneHydrated) return;
    await this._conversations.list.load();
    this.paneLayout.hydrate();
    this._paneHydrated = true;

    if (this.paneLayout.focusedPane.tabOrder.length !== 0) return;
    runInAction(() => {
      for (const [id, store] of this._conversations.conversations) {
        if (!store.isInitialConversation) continue;
        if (store.data.type === 'acp') {
          this.paneLayout.open('acp-chat', { conversationId: id }, { preview: false });
        } else {
          this.paneLayout.open('conversation', { conversationId: id }, { preview: false });
        }
        return;
      }
    });
  }

  activate(): void {
    this._activated = true;
    if (this._acquiredWorkspaceId) workspaceRegistry.activate(this._acquiredWorkspaceId);
  }

  private syncWorkspace(): void {
    const {
      workspaceId,
      workspacePath: path,
      workspaceSshConnectionId: sshConnectionId,
    } = this._taskStore;
    if (this._taskStore.state !== 'provisioned' || !workspaceId || !path) {
      this.suspend();
      this.releaseWorkspace();
      return;
    }
    if (this._acquiredWorkspaceId === workspaceId) return;

    this.suspend();
    this.releaseWorkspace();
    this._workspace = workspaceRegistry.acquire({
      projectId: this.projectId,
      workspaceId,
      path,
      gitRepository: this._gitRepository,
      sshConnectionId,
    });
    this._acquiredWorkspaceId = workspaceId;
    if (this._activated) workspaceRegistry.activate(workspaceId);
    this.initialize();
  }

  private releaseWorkspace(): void {
    if (this._acquiredWorkspaceId) workspaceRegistry.release(this._acquiredWorkspaceId);
    this._acquiredWorkspaceId = null;
    this._workspace = null;
  }

  private initialize(): void {
    if (
      this.previewServers ||
      this._initializing ||
      !this._workspace ||
      !this._acquiredWorkspaceId
    ) {
      return;
    }
    const workspace = this._workspace;
    const workspaceId = this._acquiredWorkspaceId;
    this._initializing = true;
    void this.initializeReadyWorkspace(workspace, workspaceId);
  }

  private async initializeReadyWorkspace(
    workspace: WorkspaceStore,
    workspaceId: string
  ): Promise<void> {
    this.previewServers = new PreviewServerStore({
      projectId: this.projectId,
      workspaceId,
      connectionId: workspace.sshConnectionId,
    });
    this.previewServers.start();

    try {
      await this.hydrateAndSeedPaneLayout();
    } catch (error) {
      log.error('Failed to hydrate task pane layout:', error);
    }
    if (this._workspace !== workspace || this._acquiredWorkspaceId !== workspaceId) {
      this._initializing = false;
      return;
    }
    const gitCheckout = workspace.get(gitCheckoutStoreToken);
    this.prStore = new PrStore(
      this.projectId,
      workspaceId,
      this._gitRepository,
      gitCheckout,
      this._taskStore
    );

    const diffSelectionHandle = sanitizedMemento(this._diffSelectionHandle, {
      deps: () =>
        gitCheckout.hasData
          ? {
              workspacePath: workspace.path,
              validPaths: new Set([
                ...gitCheckout.unstagedFileChanges.map((file) => file.path),
                ...gitCheckout.stagedFileChanges.map((file) => file.path),
              ]),
            }
          : undefined,
      sanitize: sanitizeDiffSelection,
    });
    this.diffView = new DiffViewStore(
      gitCheckout,
      this.prStore,
      this._diffPreferencesHandle,
      diffSelectionHandle
    );
    workspace.get(diffTabManagerStoreToken).bindSession({
      gitCheckout,
      pr: this.prStore,
      diffView: this.diffView,
    });

    this.paneLayout.startPersistence();
    this._sessionDisposers.push(
      reaction(
        () => ({
          isDrawerOpen: this.isTerminalDrawerOpen,
          isCreatingTerminal: this._isCreatingTerminal,
          isLoaded: this._terminals.isLoaded,
          terminalCount: this._terminals.terminals.size,
        }),
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
      )
    );

    this.editorView.startFiles(workspace.path);
    this._sessionDisposers.push(
      reaction(
        () => {
          const files = this.editorView.files;
          if (!files) return '';
          const expanded = [...this.editorView.expandedPaths].sort().join('\0');
          const loaded = [...files.loadedPaths].sort().join('\0');
          const pending = [...files.pendingPaths].sort().join('\0');
          return `${expanded}::${loaded}::${pending}::${files.nodes.size}`;
        },
        () => {
          const files = this.editorView.files;
          if (files) files.reconcileVisibleScopes(this.editorView.expandedPaths);
        },
        { fireImmediately: true }
      )
    );
    this._initializing = false;
  }

  suspend(): void {
    this.diffView?.dispose();
    this.diffView = null;
    this._workspace?.get(diffTabManagerStoreToken).unbindSession();
    this.prStore?.dispose();
    this.prStore = null;
    this.previewServers?.dispose();
    this.previewServers = null;
    this.paneLayout.stopPersistence();
    for (const dispose of this._sessionDisposers) dispose();
    this._sessionDisposers = [];
    this.editorView.disposeFiles();
  }

  dispose(): void {
    this.suspend();
    this.releaseWorkspace();
    for (const dispose of this._disposers) dispose();
    this.paneLayout.dispose();
    this.terminalTabs.dispose();
    this.editorView.dispose();
    void this.space.release().catch((error: unknown) => getMementoClient().reportError(error));
  }

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

  setSidebarTab(value: SidebarTab): void {
    this._chromeHandle.update((current) => ({ ...current, sidebarTab: value }));
  }

  setSidebarCollapsed(collapsed: boolean): void {
    this._chromeHandle.update((current) => ({ ...current, sidebarCollapsed: collapsed }));
  }

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

  async openNewTerminal(shell?: TerminalShellId): Promise<string | undefined> {
    this._chromeHandle.update((current) => ({ ...current, terminalDrawerOpen: true }));
    this.setFocusedRegion('bottom');
    const terminalId = await this.createDefaultTerminal(shell);
    if (!terminalId) return undefined;
    runInAction(() => {
      this.terminalTabs.setActiveTab(terminalId);
      this.setTerminalDrawerActiveItem({ kind: 'terminal', id: terminalId });
    });
    return terminalId;
  }

  private async createDefaultTerminal(shell?: TerminalShellId): Promise<string | undefined> {
    if (this._isCreatingTerminal) return undefined;
    this._isCreatingTerminal = true;
    try {
      return (await this._terminals.createDefaultTerminal(shell))?.id;
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
  return { ...value, tabOrder, activeTabId, activeItem };
}

function sanitizePaneLayoutConversations(
  value: TaskPaneLayoutState,
  conversationIds: ReadonlySet<string>
): TaskPaneLayoutState {
  const groups = value.groups.map((group) => {
    const tabs = group.tabManager.tabs.filter(
      (tab) =>
        (tab.kind !== 'conversation' && tab.kind !== 'acp-chat') ||
        conversationIds.has(tab.conversationId)
    );
    const activeTabId =
      group.tabManager.activeTabId && tabs.some((tab) => tab.tabId === group.tabManager.activeTabId)
        ? group.tabManager.activeTabId
        : tabs[0]?.tabId;
    return {
      ...group,
      tabManager: {
        ...group.tabManager,
        tabs,
        activeTabId,
      },
    };
  });
  const activeGroupId = groups.some((group) => group.groupId === value.activeGroupId)
    ? value.activeGroupId
    : groups[0]?.groupId;
  return {
    ...value,
    groups,
    activeGroupId: activeGroupId ?? value.activeGroupId,
  };
}
