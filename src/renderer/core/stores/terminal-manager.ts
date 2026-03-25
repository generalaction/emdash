import {
  makeAutoObservable,
  makeObservable,
  observable,
  onBecomeObserved,
  runInAction,
} from 'mobx';
import { makePtySessionId } from '@shared/ptySessionId';
import { CreateTerminalParams, Terminal } from '@shared/terminals';
import { rpc } from '@renderer/core/ipc';
import { TabsStore } from '@renderer/core/stores/tabs-store';
import { PtySession } from './pty-session';
import { TerminalsViewState } from './terminal-view-store';

export class TerminalManagerStore {
  private readonly projectId: string;
  private readonly taskId: string;
  private _loaded = false;
  readonly view = new TerminalsViewState();
  terminals = observable.map<string, TerminalStore>();
  tabs = new TabsStore();

  constructor(projectId: string, taskId: string) {
    this.projectId = projectId;
    this.taskId = taskId;
    makeObservable(this, { terminals: observable });
    onBecomeObserved(this, 'terminals', () => {
      if (this._loaded) return;
      this.load();
    });
  }

  async load() {
    this._loaded = true;
    const terminals = await rpc.terminals.getTerminalsForTask(this.projectId, this.taskId);
    runInAction(() => {
      for (const terminal of terminals) {
        const store = new TerminalStore(terminal);
        this.terminals.set(terminal.id, store);
        this.tabs.addTab(terminal.id);
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
      this.tabs.addTab(params.id);
      this.tabs.setActiveTab(params.id);
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
        this.tabs.removeTab(params.id);
      });
      throw err;
    }
  }

  async deleteTerminal(terminalId: string): Promise<void> {
    const snapshot = this.terminals.get(terminalId);
    if (!snapshot) return;

    const previousTabOrder = this.tabs.tabOrder.slice();
    const previousActiveTabId = this.tabs.activeTabId;

    runInAction(() => {
      this.terminals.delete(terminalId);
      this.tabs.removeTab(terminalId);
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
        this.tabs.tabOrder = previousTabOrder;
        if (previousActiveTabId) this.tabs.setActiveTab(previousActiveTabId);
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

  reorderTerminals(fromIndex: number, toIndex: number): void {
    this.tabs.reorderTabs(fromIndex, toIndex);
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
    makeAutoObservable(this);
  }

  dispose() {
    this.session.dispose();
  }
}
