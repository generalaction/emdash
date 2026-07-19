import { computed, makeAutoObservable, observable, reaction, runInAction } from 'mobx';
import type { ConversationManagerStore } from '@core/features/conversations/browser/conversation-manager';
import { DefaultConversationSeeder } from '@core/features/conversations/browser/default-conversation-seeder';
import { EditorViewStore } from '@core/features/editor/browser/task-editor/stores/editor-view-store';
import type { FileTabResource } from '@core/features/editor/browser/task-editor/stores/file-tab-resource';
import {
  diffTabManagerStoreToken,
  gitCheckoutStoreToken,
} from '@core/features/source-control/browser/contributions/workspace-store-tokens';
import { DiffViewStore } from '@core/features/source-control/browser/diff-view/stores/diff-view-store';
import type { GitRepositoryStore } from '@core/features/source-control/browser/stores/git-repository-store';
import { PrStore } from '@core/features/source-control/browser/stores/pr-store';
import { PreviewServerStore } from '@core/features/tasks/browser/stores/preview-server-store';
import { TaskNavigationParticipant } from '@core/features/tasks/browser/stores/task-navigation-participant';
import type { TaskStore } from '@core/features/tasks/browser/stores/task-store';
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
import { taskViewDef } from '@core/features/tasks/contributions/views';
import type { TerminalManagerStore } from '@core/features/terminals/browser/task-terminal/terminal-manager';
import { TerminalTabViewStore } from '@core/features/terminals/browser/task-terminal/terminal-tab-view-store';
import type { WorkspaceStore } from '@core/features/workspaces/browser/stores/workspace';
import { workspaceRegistry } from '@core/features/workspaces/browser/stores/workspace-registry';
import {
  sanitizedMemento,
  type MementoHandle,
  type SubjectSpace,
} from '@core/primitives/mementos/browser';
import type { TerminalShellId } from '@core/primitives/terminals/api';
import { getMementoClient } from '@renderer/lib/mementos';
import { appState } from '@renderer/lib/stores/app-state';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { log } from '@renderer/utils/logger';
import type { TaskTabContext } from './tabs/core/task-tab-context';
import { sanitizeDiffSelection } from './task-composition-state';
import { taskTabView } from './task-tab-registry';

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

  private readonly _seeder: DefaultConversationSeeder;
  private readonly _chromeHandle: MementoHandle<TaskChromeState>;
  private readonly _terminalSelectionHandle: MementoHandle<TaskTerminalSelectionState>;
  private readonly _diffPreferencesHandle: MementoHandle<TaskDiffPreferencesState>;
  private readonly _diffSelectionHandle: MementoHandle<TaskDiffSelectionState>;

  constructor(
    readonly projectId: string,
    readonly taskId: string,
    private readonly _taskStore: TaskStore,
    private readonly _terminals: TerminalManagerStore,
    conversations: ConversationManagerStore,
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
      paneLayoutMemento: this.space.handle(taskPaneLayoutMemento),
    };
    this.paneLayout = taskTabView.createPaneLayoutStore(taskCtx, {
      onActiveTabChange: (tabId) => {
        if (tabId) appState.navigation.reportLocation(taskRef, { tabId });
      },
    });
    this._disposers.push(
      appState.navigation.attachParticipant(taskRef, new TaskNavigationParticipant(this.paneLayout))
    );
    this._seeder = new DefaultConversationSeeder(conversations, this.paneLayout);
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

  hydrate(): void {
    if (this._paneHydrated) return;
    if (this.paneLayout.hydrate()) this._seeder.markConsumed(true);
    this._paneHydrated = true;
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
    if (this.previewServers || !this._workspace || !this._acquiredWorkspaceId) return;
    this.hydrate();

    const workspace = this._workspace;
    const workspaceId = this._acquiredWorkspaceId;
    const gitCheckout = workspace.get(gitCheckoutStoreToken);
    this.previewServers = new PreviewServerStore({
      projectId: this.projectId,
      workspaceId,
      connectionId: workspace.sshConnectionId,
    });
    this.previewServers.start();
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
    this._seeder.seed();
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
    this._seeder.dispose();
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
