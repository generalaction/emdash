import { computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import { makeFileLinkHandlers } from '@renderer/features/tasks/stores/open-file-in-file-editor';
import { rpc } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';
import type { IDisposable } from '@renderer/lib/stores/lifecycle';
import { Resource } from '@renderer/lib/stores/resource';
import { makePtySessionId } from '@shared/ptySessionId';
import type { TerminalShellId } from '@shared/terminal-settings';
import { type CreateTerminalParams, type Terminal } from '@shared/terminals';
import { nextTerminalName } from './terminal-tabs';

export class TerminalManagerStore implements IDisposable {
  readonly projectId: string;
  readonly taskId: string;
  /** Data layer: plain Terminal records loaded from the main process. */
  readonly list: Resource<Terminal[]>;
  /** Data stores keyed by terminal id — populated by reaction on list.data. */
  terminals = observable.map<string, TerminalStore>();
  /** Session layer keyed by terminal id — created alongside data, connected lazily. */
  sessions = observable.map<string, PtySession>();
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

          // Add new entries (no connect()).
          for (const terminal of data) {
            if (!this.terminals.has(terminal.id)) {
              this.terminals.set(terminal.id, new TerminalStore(terminal));
            }
            if (!this.sessions.has(terminal.id)) {
              const handlers = makeFileLinkHandlers(terminal.projectId, terminal.taskId);
              this.sessions.set(
                terminal.id,
                new PtySession(
                  makePtySessionId(terminal.projectId, terminal.taskId, terminal.id),
                  handlers.onOpenFile,
                  handlers.onOpenExternal
                )
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
      const handlers = makeFileLinkHandlers(params.projectId, params.taskId);
      this.terminals.set(params.id, new TerminalStore(optimistic));
      this.sessions.set(
        params.id,
        new PtySession(
          makePtySessionId(params.projectId, params.taskId, params.id),
          handlers.onOpenFile,
          handlers.onOpenExternal
        )
      );
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
        this.sessions.get(params.id)?.dispose();
        this.sessions.delete(params.id);
        this.terminals.delete(params.id);
      });
      throw err;
    }
  }

  async createDefaultTerminal(shell?: TerminalShellId): Promise<Terminal> {
    const names = Array.from(this.terminals.values()).map((t) => t.data.name);
    const name = nextTerminalName(names);
    const id = crypto.randomUUID();
    return this.createTerminal({ id, projectId: this.projectId, taskId: this.taskId, name, shell });
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

  dispose(): void {
    this._disposeReaction();
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.list.dispose();
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

  constructor(terminal: Terminal) {
    this.data = terminal;
    makeObservable(this, { data: observable });
  }
}
