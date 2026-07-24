import type { ScriptWorkflowState } from '@emdash/core/runtimes/terminals/api';
import { createLiveJobReplica, createLiveModelReplica, ReplicaLog } from '@emdash/wire';
import type { Terminal } from '@xterm/xterm';
import { action, computed, makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import { watchFileContent } from '@core/features/editor/api/browser/files';
import { terminalsContract } from '@core/features/terminals/api';
import { getTerminalsClient } from '@core/features/terminals/api/browser/client';
import type { FrontendPtyConnector } from '@core/features/terminals/api/browser/pty/pty';
import { PtySession } from '@core/features/terminals/api/browser/pty/pty-session';
import { createXtermLogSink } from '@core/features/terminals/api/browser/pty/xterm-log-sink';
import { PROJECT_CONFIG_FILE } from '@core/primitives/project-settings/api';
import { makePtySessionId } from '@core/primitives/pty/api';
import { createLifecycleScriptTerminalId } from '@core/primitives/terminals/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { type TabViewProvider } from '@renderer/lib/stores/generic-tab-view';
import {
  addTabId,
  setNextTabActive,
  setPreviousTabActive,
  setTabActive,
  setTabActiveIndex,
} from '@renderer/lib/stores/tab-utils';
import { log } from '@renderer/utils/logger';

export type ScriptType = 'prepare' | 'setup' | 'run' | 'teardown';

export type LifecycleScriptData = {
  id: string;
  type: ScriptType;
  label: string;
  command: string;
};

export type LifecycleScriptStatus = 'idle' | 'pending' | 'running' | 'succeeded' | 'failed';

export class LifecycleScriptStore {
  data: LifecycleScriptData;
  session: PtySession;
  status: LifecycleScriptStatus = 'idle';
  private activeRun: { cancel(): void; dispose(): Promise<void> } | null = null;
  constructor(
    data: LifecycleScriptData,
    projectId: string,
    workspaceId: string,
    outputAvailable = false
  ) {
    this.data = data;
    this.session = new PtySession(
      makePtySessionId(projectId, workspaceId, data.id),
      undefined,
      undefined,
      undefined,
      outputAvailable
        ? createTerminalsConnector(workspaceId, makePtySessionId(projectId, workspaceId, data.id))
        : createUnavailableConnector()
    );
    makeObservable(this, {
      data: observable,
      session: observable,
      status: observable,
      isRunning: computed,
      setStatus: action,
    });
  }

  get isRunning(): boolean {
    return this.status === 'running';
  }

  setStatus(status: LifecycleScriptStatus): void {
    this.status = status;
  }

  async run(projectId: string, taskId: string, workspaceId: string): Promise<void> {
    if (this.activeRun || this.isRunning) return;
    const client = await getTerminalsClient();
    const jobs = createLiveJobReplica(
      terminalsContract.runScriptWorkflow,
      client.runScriptWorkflow
    );
    const lease = await jobs.start({
      projectId,
      taskId,
      workspaceId,
      type: this.data.type,
    });
    const job = await lease.ready();
    this.activeRun = {
      cancel: () => void job.cancel(),
      dispose: async () => {
        await lease.release();
        await jobs.dispose();
      },
    };
    try {
      await job.result;
    } catch {
      // Status and failure surfaces are driven by the workflow model.
    } finally {
      const active = this.activeRun;
      this.activeRun = null;
      await active?.dispose();
    }
  }

  stop(): void {
    this.activeRun?.cancel();
  }

  dispose() {
    void this.activeRun?.dispose();
    this.activeRun = null;
    this.session.destroy();
  }
}

export class LifecycleScriptsStore implements TabViewProvider<LifecycleScriptStore, never> {
  private readonly projectId: string;
  private readonly workspaceId: string;
  private _loaded = false;
  private _disposed = false;
  private _refreshSeq = 0;
  private readonly _unsubscribes: Array<() => void> = [];
  private readonly outputAvailable: boolean;
  private workflowReplica: { dispose(): Promise<void> | void } | null = null;
  scripts = observable.map<string, LifecycleScriptStore>();
  tabOrder: string[] = [];
  activeTabId: string | undefined = undefined;

  constructor(projectId: string, workspaceId: string, localWorkspacePath?: string) {
    this.projectId = projectId;
    this.workspaceId = workspaceId;
    this.outputAvailable = localWorkspacePath !== undefined;
    makeObservable(this, {
      scripts: observable,
      tabOrder: observable,
      activeTabId: observable,
      tabs: computed,
      activeTab: computed,
      setNextTabActive: action,
      setPreviousTabActive: action,
      setTabActiveIndex: action,
      setActiveTab: action,
    });
    onBecomeObserved(this, 'tabOrder', () => {
      if (this._loaded) return;
      void this.load();
    });
    void getDesktopWireClient().then(async (client) => {
      const unsubscribe = await client.projects.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.projectId === this.projectId) this.reloadIfLoaded();
        },
        onGap: () => this.reloadIfLoaded(),
      });
      if (this._disposed) unsubscribe();
      else this._unsubscribes.push(unsubscribe);
    });
    void watchFileContent(this.workspaceId, PROJECT_CONFIG_FILE, () => {
      this.reloadIfLoaded();
    })
      .then((unsubscribe) => {
        if (this._disposed) unsubscribe();
        else this._unsubscribes.push(unsubscribe);
      })
      .catch(() => {});
    if (localWorkspacePath) this.bindWorkflowState();
  }

  get tabs(): LifecycleScriptStore[] {
    return this.tabOrder
      .map((id) => this.scripts.get(id))
      .filter(Boolean) as LifecycleScriptStore[];
  }

  get activeTab(): LifecycleScriptStore | undefined {
    return this.activeTabId ? this.scripts.get(this.activeTabId) : undefined;
  }

  setActiveTab(id: string): void {
    setTabActive(this, id);
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

  closeActiveTab(): void {
    // lifecycle scripts are not closeable
  }

  addTab(_args: never): void {
    // lifecycle scripts come from settings, not user actions
  }

  removeTab(_id: string): void {
    // lifecycle scripts are not removeable
  }

  reorderTabs(_fromIndex: number, _toIndex: number): void {
    // lifecycle scripts have a fixed order
  }

  private async load(): Promise<void> {
    if (this._disposed) return;
    this._loaded = true;
    await this.reload();
  }

  private reloadIfLoaded(): void {
    if (!this._loaded || this._disposed) return;
    void this.reload();
  }

  private async reload(): Promise<void> {
    if (this._disposed) return;
    const refreshSeq = ++this._refreshSeq;
    const result = await (
      await getDesktopWireClient()
    ).projectSettings.getSettings({ workspaceId: this.workspaceId });
    if (this._disposed) return;
    if (!result.success) return;
    const settings = result.data;

    const entries: { type: ScriptType; command: string; label: string }[] = [];
    if (settings.scripts?.prepare) {
      entries.push({ type: 'prepare', command: settings.scripts.prepare, label: 'Prepare' });
    }
    if (settings.scripts?.setup) {
      entries.push({ type: 'setup', command: settings.scripts.setup, label: 'Setup' });
    }
    if (settings.scripts?.run) {
      entries.push({ type: 'run', command: settings.scripts.run, label: 'Run' });
    }
    if (settings.scripts?.teardown) {
      entries.push({ type: 'teardown', command: settings.scripts.teardown, label: 'Teardown' });
    }

    const resolved = entries.map((entry) => ({
      ...entry,
      id: createLifecycleScriptTerminalId(entry.type),
    }));
    if (refreshSeq !== this._refreshSeq || this._disposed) return;

    runInAction(() => {
      if (this._disposed) return;
      const incomingIds = new Set(resolved.map((entry) => entry.id));

      for (const id of Array.from(this.scripts.keys())) {
        if (incomingIds.has(id)) continue;
        this.scripts.get(id)?.dispose();
        this.scripts.delete(id);
        this.tabOrder = this.tabOrder.filter((tabId) => tabId !== id);
      }

      for (const entry of resolved) {
        const data = { id: entry.id, type: entry.type, label: entry.label, command: entry.command };
        const existing = this.scripts.get(entry.id);
        if (existing) {
          Object.assign(existing.data, data);
        } else {
          const store = new LifecycleScriptStore(
            data,
            this.projectId,
            this.workspaceId,
            this.outputAvailable
          );
          this.scripts.set(entry.id, store);
          addTabId(this, entry.id);
        }
      }

      this.tabOrder = resolved.map((entry) => entry.id);
      if (!this.activeTabId && this.tabOrder.length > 0) {
        this.activeTabId = this.tabOrder[0];
      } else if (this.activeTabId && !this.scripts.has(this.activeTabId)) {
        this.activeTabId = this.tabOrder[0];
      }
    });
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._refreshSeq++;
    for (const unsubscribe of this._unsubscribes) unsubscribe();
    void this.workflowReplica?.dispose();
    this.workflowReplica = null;
    for (const script of this.scripts.values()) {
      script.dispose();
    }
    this.scripts.clear();
    this.tabOrder = [];
    this.activeTabId = undefined;
  }

  private bindWorkflowState(): void {
    if (!this.outputAvailable) return;
    if (typeof window === 'undefined') return;
    void (async () => {
      const client = await getTerminalsClient();
      if (this._disposed) return;
      const replica = createLiveModelReplica(terminalsContract.workflows, client.workflows, {
        onChange: {
          state: (state: ScriptWorkflowState | null) => this.handleWorkflowState(state),
        },
      });
      const lease = replica.acquire({ workspaceId: this.workspaceId });
      this.workflowReplica = {
        dispose: async () => {
          await lease.release();
          await replica.dispose();
        },
      };
      await lease.ready();
      if (this._disposed) void this.workflowReplica.dispose();
    })();
  }

  private handleWorkflowState(state: ScriptWorkflowState | null): void {
    runInAction(() => {
      for (const script of this.scripts.values()) {
        const node = state?.nodes[script.data.type];
        if (!node) {
          script.setStatus('idle');
        } else if (node.status === 'done') {
          script.setStatus('succeeded');
        } else if (node.status === 'skipped') {
          script.setStatus('idle');
        } else {
          script.setStatus(node.status);
        }
      }
    });
  }
}

function createTerminalsConnector(workspaceId: string, terminalId: string): FrontendPtyConnector {
  let logBinding: ReplicaLog | null = null;
  let clientPromise: ReturnType<typeof getTerminalsClient> | null = null;
  const client = () => {
    clientPromise ??= getTerminalsClient();
    return clientPromise;
  };

  return {
    async connect(terminal: Terminal) {
      const runtime = await client();
      logBinding = new ReplicaLog(runtime.output.handle({ workspaceId, terminalId }), {
        store: createXtermLogSink(terminal),
      });
      await logBinding.ready;
      return () => {
        void logBinding?.dispose();
        logBinding = null;
      };
    },
    sendInput(data: string) {
      void client()
        .then(async (runtime) => {
          const result = await runtime.sendInput({ workspaceId, terminalId, data });
          if (!result.success) {
            log.warn('lifecycle-scripts: terminal input failed', {
              terminalId,
              error: result.error,
            });
          }
        })
        .catch((error) => {
          log.warn('lifecycle-scripts: failed to send terminal input', { terminalId, error });
        });
    },
    resize(cols: number, rows: number) {
      void client()
        .then(async (runtime) => {
          const result = await runtime.resize({ workspaceId, terminalId, cols, rows });
          if (!result.success) {
            log.warn('lifecycle-scripts: terminal resize failed', {
              terminalId,
              error: result.error,
            });
          }
        })
        .catch((error) => {
          log.warn('lifecycle-scripts: failed to resize terminal', { terminalId, error });
        });
    },
  };
}

function createUnavailableConnector(): FrontendPtyConnector {
  return {
    connect(terminal) {
      terminal.write('Terminal output is unavailable for this workspace.\r\n');
      return () => {};
    },
  };
}
