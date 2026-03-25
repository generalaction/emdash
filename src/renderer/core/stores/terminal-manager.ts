import { action, computed, makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import { makePtySessionId } from '@shared/ptySessionId';
import { CreateTerminalParams, Terminal } from '@shared/terminals';
import { rpc } from '@renderer/core/ipc';
import { TabViewProvider, TabViewSnapshot } from '@renderer/core/stores/generic-tab-view';
import { Snapshottable } from '@renderer/core/stores/snapshottable';
import {
  addTabId,
  removeTabId,
  reorderTabIds,
  setNextTabActive,
  setPreviousTabActive,
  setTabActive,
  setTabActiveIndex,
} from '@renderer/core/stores/tab-utils';
import { PtySession } from './pty-session';

export class TerminalManagerStore
  implements TabViewProvider<TerminalStore, CreateTerminalParams>, Snapshottable<TabViewSnapshot>
{
  private readonly projectId: string;
  private readonly taskId: string;
  private _loaded = false;
  terminals = observable.map<string, TerminalStore>();
  tabOrder: string[] = [];
  activeTabId: string | undefined = undefined;

  constructor(projectId: string, taskId: string) {
    this.projectId = projectId;
    this.taskId = taskId;
    makeObservable(this, {
      terminals: observable,
      tabOrder: observable,
      activeTabId: observable,
      tabs: computed,
      activeTab: computed,
      snapshot: computed,
      addTab: action,
      removeTab: action,
      reorderTabs: action,
      setNextTabActive: action,
      setPreviousTabActive: action,
      setTabActiveIndex: action,
      setActiveTab: action,
    });
    onBecomeObserved(this, 'terminals', () => {
      if (this._loaded) return;
      this.load();
    });
  }

  get tabs(): TerminalStore[] {
    return this.tabOrder.map((id) => this.terminals.get(id)).filter(Boolean) as TerminalStore[];
  }

  get activeTab(): TerminalStore | undefined {
    return this.activeTabId ? this.terminals.get(this.activeTabId) : undefined;
  }

  get snapshot(): TabViewSnapshot {
    return { tabOrder: this.tabOrder.slice(), activeTabId: this.activeTabId };
  }

  restoreSnapshot(snapshot: Partial<TabViewSnapshot>): void {
    if (snapshot.tabOrder) this.tabOrder = snapshot.tabOrder;
    if (snapshot.activeTabId !== undefined) this.activeTabId = snapshot.activeTabId;
  }

  setActiveTab(id: string): void {
    setTabActive(this, id);
  }

  reorderTabs(fromIndex: number, toIndex: number): void {
    reorderTabIds(this, fromIndex, toIndex);
  }

  setNextTabActive(): void {
    setNextTabActive(this);
  }

  setPreviousTabActive(): void {
    setPreviousTabActive(this);
  }

  setTabActiveIndex(index: number): void {
    setTabActiveIndex(this, index);
  }

  addTab(params: CreateTerminalParams): void {
    void this.createTerminal(params);
  }

  removeTab(terminalId: string): void {
    void this.deleteTerminal(terminalId);
  }

  async load() {
    this._loaded = true;
    const terminals = await rpc.terminals.getTerminalsForTask(this.projectId, this.taskId);
    runInAction(() => {
      for (const terminal of terminals) {
        const store = new TerminalStore(terminal);
        this.terminals.set(terminal.id, store);
        addTabId(this, terminal.id);
        void store.session.connect();
      }
    });
  }

  async createTerminal(params: CreateTerminalParams): Promise<Terminal> {
    const optimistic: Terminal = {
      id: params.id,
      projectId: params.projectId,
      taskId: params.taskId,
      name: params.name,
    };

    runInAction(() => {
      const store = new TerminalStore(optimistic);
      this.terminals.set(params.id, store);
      addTabId(this, params.id);
      setTabActive(this, params.id);
      void store.session.connect();
    });

    try {
      const terminal = await rpc.terminals.createTerminal(params);
      runInAction(() => {
        const store = this.terminals.get(params.id);
        if (store) {
          Object.assign(store.data, terminal);
        }
      });
      return terminal;
    } catch (err) {
      runInAction(() => {
        this.terminals.get(params.id)?.dispose();
        this.terminals.delete(params.id);
        removeTabId(this, params.id);
      });
      throw err;
    }
  }

  async deleteTerminal(terminalId: string): Promise<void> {
    const snapshot = this.terminals.get(terminalId);
    if (!snapshot) return;

    const tabSnapshot = this.snapshot;

    runInAction(() => {
      this.terminals.delete(terminalId);
      removeTabId(this, terminalId);
    });

    try {
      await rpc.terminals.deleteTerminal({
        projectId: this.projectId,
        taskId: this.taskId,
        terminalId,
      });
      snapshot.dispose();
    } catch (err) {
      runInAction(() => {
        this.terminals.set(terminalId, snapshot);
        this.restoreSnapshot(tabSnapshot);
      });
      throw err;
    }
  }

  async renameTerminal(terminalId: string, name: string): Promise<void> {
    const store = this.terminals.get(terminalId);
    if (!store) return;

    const previousName = store.data.name;

    runInAction(() => {
      store.data.name = name;
    });

    try {
      await rpc.terminals.renameTerminal(terminalId, name);
    } catch (err) {
      runInAction(() => {
        store.data.name = previousName;
      });
      throw err;
    }
  }
}

export class TerminalStore {
  data: Terminal;
  session: PtySession;

  constructor(terminal: Terminal) {
    this.data = terminal;
    this.session = new PtySession(
      makePtySessionId(terminal.projectId, terminal.taskId, terminal.id)
    );
    makeObservable(this, { data: observable, session: observable });
  }

  dispose() {
    this.session.dispose();
  }
}
