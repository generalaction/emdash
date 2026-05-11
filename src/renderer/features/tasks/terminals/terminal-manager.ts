import { makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import {
  terminalCreatedChannel,
  terminalDeletedChannel,
  terminalUpdatedChannel,
} from '@shared/events/terminalEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { type CreateTerminalParams, type Terminal } from '@shared/terminals';
import { events, rpc } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { nextTerminalName } from './terminal-tabs';

export class TerminalManagerStore {
  readonly projectId: string;
  readonly taskId: string;
  private _loaded = false;
  private offTerminalCreated: (() => void) | null = null;
  private offTerminalUpdated: (() => void) | null = null;
  private offTerminalDeleted: (() => void) | null = null;
  terminals = observable.map<string, TerminalStore>();

  constructor(projectId: string, taskId: string) {
    this.projectId = projectId;
    this.taskId = taskId;
    makeObservable(this, {
      terminals: observable,
    });
    this.offTerminalCreated = events.on(terminalCreatedChannel, (terminal) => {
      if (terminal.projectId !== this.projectId || terminal.taskId !== this.taskId) return;
      this.upsertTerminal(terminal);
    });
    this.offTerminalUpdated = events.on(terminalUpdatedChannel, (terminal) => {
      if (terminal.projectId !== this.projectId || terminal.taskId !== this.taskId) return;
      this.upsertTerminal(terminal);
    });
    this.offTerminalDeleted = events.on(
      terminalDeletedChannel,
      ({ terminalId, projectId, taskId }) => {
        if (projectId !== this.projectId || taskId !== this.taskId) return;
        this.removeTerminal(terminalId);
      }
    );
    onBecomeObserved(this, 'terminals', () => {
      if (this._loaded) return;
      void this.load();
    });
  }

  private upsertTerminal(terminal: Terminal): void {
    runInAction(() => {
      const existing = this.terminals.get(terminal.id);
      if (existing) {
        Object.assign(existing.data, terminal);
        return;
      }
      const store = new TerminalStore(terminal);
      this.terminals.set(terminal.id, store);
      void store.session.connect();
    });
  }

  private removeTerminal(terminalId: string): void {
    const store = this.terminals.get(terminalId);
    if (!store) return;
    store.dispose();
    runInAction(() => {
      this.terminals.delete(terminalId);
    });
  }

  async load() {
    this._loaded = true;
    const terminals = await rpc.terminals.getTerminalsForTask(this.projectId, this.taskId);
    for (const terminal of terminals) {
      this.upsertTerminal(terminal);
    }
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

  async createDefaultTerminal(): Promise<Terminal> {
    const names = Array.from(this.terminals.values()).map((t) => t.data.name);
    const name = nextTerminalName(names);
    const id = crypto.randomUUID();
    return this.createTerminal({ id, projectId: this.projectId, taskId: this.taskId, name });
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

  dispose(): void {
    this.offTerminalCreated?.();
    this.offTerminalCreated = null;
    this.offTerminalUpdated?.();
    this.offTerminalUpdated = null;
    this.offTerminalDeleted?.();
    this.offTerminalDeleted = null;
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
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
