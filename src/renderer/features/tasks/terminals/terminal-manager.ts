import { computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import {
  terminalCreatedChannel,
  terminalDeletedChannel,
  terminalUpdatedChannel,
} from '@shared/events/terminalEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { type CreateTerminalParams, type Terminal } from '@shared/terminals';
import { events, rpc } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { Resource } from '@renderer/lib/stores/resource';
import { nextTerminalName } from './terminal-tabs';

export class TerminalManagerStore {
  readonly projectId: string;
  readonly taskId: string;
  /** Data layer: plain Terminal records loaded from the main process. */
  readonly list: Resource<Terminal[]>;
  /** Data stores keyed by terminal id — populated by reaction on list.data. */
  terminals = observable.map<string, TerminalStore>();
  /** Session layer keyed by terminal id — created alongside data, connected lazily. */
  sessions = observable.map<string, PtySession>();
  private offTerminalCreated: (() => void) | null = null;
  private offTerminalUpdated: (() => void) | null = null;
  private offTerminalDeleted: (() => void) | null = null;
  private readonly _disposeReaction: () => void;

  constructor(projectId: string, taskId: string) {
    this.projectId = projectId;
    this.taskId = taskId;

    this.list = new Resource<Terminal[]>(
      () => rpc.terminals.getTerminalsForTask(projectId, taskId),
      [{ kind: 'demand' }]
    );

    makeObservable(this, {
      terminals: observable,
      sessions: observable,
      isLoaded: computed,
    });

    // Sync terminals and sessions maps whenever the resource data changes.
    // fireImmediately ensures the reaction runs once on construction to establish
    // the dependency on list.data, which triggers the demand-strategy load.
    this._disposeReaction = reaction(
      () => this.list.data,
      (data) => {
        if (!data) return;
        runInAction(() => {
          const incomingIds = new Set(data.map((t) => t.id));

          // Add/update entries without connecting sessions.
          for (const terminal of data) {
            const existing = this.terminals.get(terminal.id);
            if (existing) {
              Object.assign(existing.data, terminal);
            } else {
              this.terminals.set(terminal.id, new TerminalStore(terminal));
            }
            if (!this.sessions.has(terminal.id)) {
              this.sessions.set(
                terminal.id,
                new PtySession(makePtySessionId(terminal.projectId, terminal.taskId, terminal.id))
              );
            }
          }

          // Remove stale entries.
          const staleIds = Array.from(this.terminals.keys()).filter((id) => !incomingIds.has(id));
          for (const id of staleIds) {
            this.sessions.get(id)?.dispose();
            this.sessions.delete(id);
            this.terminals.delete(id);
          }
        });
      },
      { fireImmediately: true }
    );

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
      ({ terminalId, projectId: eventProjectId, taskId: eventTaskId }) => {
        if (eventProjectId !== this.projectId || eventTaskId !== this.taskId) return;
        this.removeTerminal(terminalId);
      }
    );
  }

  private upsertTerminal(terminal: Terminal): void {
    if (this.list.data) {
      const exists = this.list.data.some((item) => item.id === terminal.id);
      this.list.setValue(
        exists
          ? this.list.data.map((item) => (item.id === terminal.id ? terminal : item))
          : [...this.list.data, terminal]
      );
      return;
    }

    runInAction(() => {
      const existing = this.terminals.get(terminal.id);
      if (existing) {
        Object.assign(existing.data, terminal);
      } else {
        this.terminals.set(terminal.id, new TerminalStore(terminal));
      }
      if (!this.sessions.has(terminal.id)) {
        this.sessions.set(
          terminal.id,
          new PtySession(makePtySessionId(terminal.projectId, terminal.taskId, terminal.id))
        );
      }
    });
  }

  private removeTerminal(terminalId: string): void {
    if (this.list.data?.some((item) => item.id === terminalId)) {
      this.list.setValue(this.list.data.filter((item) => item.id !== terminalId));
      return;
    }

    runInAction(() => {
      this.sessions.get(terminalId)?.dispose();
      this.sessions.delete(terminalId);
      this.terminals.delete(terminalId);
    });
  }

  get isLoaded(): boolean {
    return this.list.data !== null;
  }

  async createTerminal(params: CreateTerminalParams): Promise<Terminal> {
    const optimistic: Terminal = {
      id: params.id,
      projectId: params.projectId,
      taskId: params.taskId,
      name: params.name,
    };

    runInAction(() => {
      this.terminals.set(params.id, new TerminalStore(optimistic));
      this.sessions.set(
        params.id,
        new PtySession(makePtySessionId(params.projectId, params.taskId, params.id))
      );
    });

    try {
      const terminal = await rpc.terminals.createTerminal(params);
      this.upsertTerminal(terminal);
      return terminal;
    } catch (err) {
      runInAction(() => {
        this.sessions.get(params.id)?.dispose();
        this.sessions.delete(params.id);
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
    const session = this.sessions.get(terminalId);
    if (!store) return;

    runInAction(() => {
      this.terminals.delete(terminalId);
      this.sessions.delete(terminalId);
    });

    try {
      await rpc.terminals.deleteTerminal({
        projectId: this.projectId,
        taskId: this.taskId,
        terminalId,
      });
      session?.dispose();
    } catch (err) {
      runInAction(() => {
        this.terminals.set(terminalId, store);
        if (session) this.sessions.set(terminalId, session);
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
    this._disposeReaction();
    this.offTerminalCreated?.();
    this.offTerminalCreated = null;
    this.offTerminalUpdated?.();
    this.offTerminalUpdated = null;
    this.offTerminalDeleted?.();
    this.offTerminalDeleted = null;
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.list.dispose();
  }
}

export class TerminalStore {
  data: Terminal;

  constructor(terminal: Terminal) {
    this.data = terminal;
    makeObservable(this, { data: observable });
  }
}
