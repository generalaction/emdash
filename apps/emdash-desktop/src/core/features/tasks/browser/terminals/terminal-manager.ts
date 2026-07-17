import type { TerminalKey } from '@emdash/core/runtimes/terminals/api';
import type { Disposable } from '@emdash/shared/concurrency';
import { ReplicaLog } from '@emdash/wire';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import { computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import { getAppSettingValueSnapshot } from '@core/features/settings/browser/app-settings-client';
import { makeFileLinkHandlers } from '@core/features/tasks/browser/stores/open-file-in-file-editor';
import { makePtySessionId } from '@core/primitives/pty/api';
import type { TerminalShellId } from '@core/primitives/terminals/api';
import { type CreateTerminalParams, type Terminal } from '@core/primitives/terminals/api';
import type { FrontendPtyConnector } from '@renderer/lib/pty/pty';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { createXtermLogSink } from '@renderer/lib/pty/xterm-log-sink';
import { getTerminalTabsWireClient } from '@renderer/lib/runtime/terminal-tabs-client';
import { getTerminalsRuntimeClient } from '@renderer/lib/runtime/terminals-client';
import { Resource } from '@renderer/lib/stores/resource';
import { log } from '@renderer/utils/logger';
import { nextTerminalName } from './terminal-tabs';

export class TerminalManagerStore implements Disposable {
  readonly projectId: string;
  readonly taskId: string;
  /** Data layer: plain Terminal records loaded from the main process. */
  readonly list: Resource<Terminal[]>;
  /** Data stores keyed by terminal id — populated by reaction on list.data. */
  terminals = observable.map<string, TerminalStore>();
  /** Session layer keyed by terminal id — created alongside data, connected lazily. */
  sessions = observable.map<string, PtySession>();
  // Shallow: TerminalKey values must stay plain objects so they can be
  // structured-cloned when posted over the wire (MobX proxies cannot).
  runtimeKeys = observable.map<string, TerminalKey>({}, { deep: false });
  private readonly _disposeReaction: () => void;

  constructor(projectId: string, taskId: string) {
    this.projectId = projectId;
    this.taskId = taskId;

    this.list = new Resource<Terminal[]>(async () => {
      const result = await (await getTerminalTabsWireClient()).list({ projectId, taskId });
      if (!result.success) throw new Error(result.error.message);
      return result.data;
    }, [{ kind: 'demand' }]);

    makeObservable(this, {
      terminals: observable,
      sessions: observable,
      runtimeKeys: observable,
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
              this.sessions.set(terminal.id, this.createSession(terminal));
            }
          }

          // Remove stale entries.
          const staleIds = Array.from(this.terminals.keys()).filter((id) => !incomingIds.has(id));
          for (const id of staleIds) {
            this.sessions.get(id)?.destroy();
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
    const defaultShell = getAppSettingValueSnapshot('terminal')?.defaultShell ?? 'system';
    const optimistic: Terminal = {
      id: params.id,
      projectId: params.projectId,
      taskId: params.taskId,
      shellId: params.shell ?? defaultShell,
      name: params.name,
    };

    runInAction(() => {
      this.terminals.set(params.id, new TerminalStore(optimistic));
      this.sessions.set(params.id, this.createSession(optimistic));
    });

    try {
      const result = await (await getTerminalTabsWireClient()).create(params);
      if (!result.success) throw new Error(result.error.message);
      const { terminal, key } = result.data;
      runInAction(() => {
        const store = this.terminals.get(params.id);
        if (store) {
          Object.assign(store.data, terminal);
        }
        this.runtimeKeys.set(params.id, key);
      });
      return terminal;
    } catch (err) {
      runInAction(() => {
        this.sessions.get(params.id)?.destroy();
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
    const params: CreateTerminalParams = {
      id,
      projectId: this.projectId,
      taskId: this.taskId,
      name,
    };
    if (shell !== undefined) params.shell = shell;
    return this.createTerminal(params);
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
      const result = await (
        await getTerminalTabsWireClient()
      ).delete({
        projectId: this.projectId,
        taskId: this.taskId,
        terminalId,
      });
      if (!result.success) throw new Error(result.error.message);
      session?.destroy();
    } catch (err) {
      runInAction(() => {
        this.terminals.set(terminalId, store);
        if (session) this.sessions.set(terminalId, session);
      });
      throw err;
    }
  }

  async hydrateTerminal(terminalId: string): Promise<void> {
    const store = this.terminals.get(terminalId);
    if (!store) return;
    const result = await (
      await getTerminalTabsWireClient()
    ).hydrate({
      projectId: this.projectId,
      taskId: this.taskId,
      terminalId,
    });
    if (!result.success) throw new Error(result.error.message);
    runInAction(() => {
      this.runtimeKeys.set(terminalId, result.data.key);
    });
  }

  dispose(): void {
    this._disposeReaction();
    for (const session of this.sessions.values()) {
      session.destroy();
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
      const result = await (await getTerminalTabsWireClient()).rename({ terminalId, name });
      if (!result.success) throw new Error(result.error.message);
    } catch (err) {
      runInAction(() => {
        store.data.name = previousName;
      });
      throw err;
    }
  }

  private createSession(terminal: Terminal): PtySession {
    const handlers = makeFileLinkHandlers(terminal.projectId, terminal.taskId);
    return new PtySession(
      makePtySessionId(terminal.projectId, terminal.taskId, terminal.id),
      () => this.hydrateTerminal(terminal.id),
      handlers.onOpenFile,
      handlers.onOpenExternal,
      createTerminalsConnector(() => this.ensureRuntimeKey(terminal.id))
    );
  }

  private async ensureRuntimeKey(terminalId: string): Promise<TerminalKey> {
    const existing = this.runtimeKeys.get(terminalId);
    if (existing) return existing;
    await this.hydrateTerminal(terminalId);
    const key = this.runtimeKeys.get(terminalId);
    if (!key) throw new Error(`Terminal ${terminalId} did not hydrate`);
    return key;
  }
}

export class TerminalStore {
  data: Terminal;

  constructor(terminal: Terminal) {
    this.data = terminal;
    makeObservable(this, { data: observable });
  }
}

function createTerminalsConnector(key: () => Promise<TerminalKey>): FrontendPtyConnector {
  let logBinding: ReplicaLog | null = null;
  let runtimePromise: ReturnType<typeof getTerminalsRuntimeClient> | null = null;
  const runtime = () => {
    runtimePromise ??= getTerminalsRuntimeClient();
    return runtimePromise;
  };

  return {
    async connect(terminal: XtermTerminal) {
      const [terminalsRuntime, terminalKey] = await Promise.all([runtime(), key()]);
      logBinding = new ReplicaLog(terminalsRuntime.output.handle(terminalKey), {
        store: createXtermLogSink(terminal),
      });
      await logBinding.ready;
      return () => {
        void logBinding?.dispose();
        logBinding = null;
      };
    },
    sendInput(data: string) {
      void Promise.all([runtime(), key()])
        .then(async ([terminalsRuntime, terminalKey]) => {
          const result = await terminalsRuntime.sendInput({ key: terminalKey, data });
          if (!result.success) {
            log.warn('TerminalManagerStore: terminal input failed', {
              terminalId: terminalKey.id,
              error: result.error,
            });
          }
        })
        .catch((error) => {
          log.warn('TerminalManagerStore: failed to send terminal input', { error });
        });
    },
    resize(cols: number, rows: number) {
      void Promise.all([runtime(), key()])
        .then(async ([terminalsRuntime, terminalKey]) => {
          const result = await terminalsRuntime.resize({ key: terminalKey, cols, rows });
          if (!result.success) {
            log.warn('TerminalManagerStore: terminal resize failed', {
              terminalId: terminalKey.id,
              error: result.error,
            });
          }
        })
        .catch((error) => {
          log.warn('TerminalManagerStore: failed to resize terminal', { error });
        });
    },
  };
}
