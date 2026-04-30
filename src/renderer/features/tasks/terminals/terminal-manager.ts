import { makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import { makePtySessionId } from '@shared/ptySessionId';
import { type CreateTerminalParams, type Terminal } from '@shared/terminals';
import { rpc } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';

export class TerminalManagerStore {
  private readonly projectId: string;
  private readonly taskId: string;
  private _loaded = false;
  terminals = observable.map<string, TerminalStore>();

  constructor(projectId: string, taskId: string) {
    this.projectId = projectId;
    this.taskId = taskId;
    makeObservable(this, {
      terminals: observable,
    });
    onBecomeObserved(this, 'terminals', () => {
      if (this._loaded) return;
      void this.load();
    });
  }

  async load() {
    this._loaded = true;
    const terminals = await rpc.terminals.getTerminalsForTask(this.projectId, this.taskId);
    runInAction(() => {
      for (const terminal of terminals) {
        const store = new TerminalStore(terminal);
        this.terminals.set(terminal.id, store);
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
      });
      throw err;
    }
  }

  async deleteTerminal(terminalId: string): Promise<void> {
    const store = this.terminals.get(terminalId);
    if (!store) return;

    runInAction(() => {
      this.terminals.delete(terminalId);
    });

    try {
      await rpc.terminals.deleteTerminal({
        projectId: this.projectId,
        taskId: this.taskId,
        terminalId,
      });
      store.dispose();
    } catch (err) {
      runInAction(() => {
        this.terminals.set(terminalId, store);
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
