import { action, computed, makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { type TabViewProvider } from '@renderer/lib/stores/generic-tab-view';
import {
  addTabId,
  setNextTabActive,
  setPreviousTabActive,
  setTabActive,
  setTabActiveIndex,
} from '@renderer/lib/stores/tab-utils';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { projectSettingsChangedChannel } from '@shared/events/projectEvents';
import { ptyExitChannel } from '@shared/events/ptyEvents';
import { PROJECT_CONFIG_FILE } from '@shared/project-settings';
import { makePtySessionId } from '@shared/ptySessionId';
import { createLifecycleScriptTerminalId } from '@shared/terminals';

export type ScriptType = 'setup' | 'run' | 'teardown';

export type LifecycleScriptData = {
  id: string;
  type: ScriptType;
  label: string;
  command: string;
};

export class LifecycleScriptStore {
  data: LifecycleScriptData;
  session: PtySession;
  isRunning = false;
  private offPtyExit: (() => void) | null = null;

  constructor(data: LifecycleScriptData, projectId: string, workspaceId: string) {
    this.data = data;
    this.session = new PtySession(makePtySessionId(projectId, workspaceId, data.id), () =>
      rpc.terminals.prepareLifecycleScript({
        projectId,
        workspaceId,
        type: data.type,
      })
    );
    this.offPtyExit = events.on(ptyExitChannel, () => this.markExited(), this.session.sessionId);
    makeObservable(this, {
      data: observable,
      session: observable,
      isRunning: observable,
      markRunning: action,
      markExited: action,
    });
  }

  markRunning(): void {
    this.isRunning = true;
  }

  markExited(): void {
    this.isRunning = false;
  }

  dispose() {
    this.offPtyExit?.();
    this.offPtyExit = null;
    this.session.dispose();
  }
}

export class LifecycleScriptsStore implements TabViewProvider<LifecycleScriptStore, never> {
  private readonly projectId: string;
  private readonly workspaceId: string;
  private _loaded = false;
  private _disposed = false;
  private _watchingConfig = false;
  private _refreshSeq = 0;
  private readonly _unsubscribes: Array<() => void> = [];
  scripts = observable.map<string, LifecycleScriptStore>();
  tabOrder: string[] = [];
  activeTabId: string | undefined = undefined;

  constructor(projectId: string, workspaceId: string) {
    this.projectId = projectId;
    this.workspaceId = workspaceId;
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
    this._unsubscribes.push(
      events.on(fsWatchEventChannel, (data) => {
        if (data.projectId !== this.projectId || data.workspaceId !== this.workspaceId) return;
        if (
          data.events.some(
            (event) => event.path === PROJECT_CONFIG_FILE || event.oldPath === PROJECT_CONFIG_FILE
          )
        ) {
          this.reloadIfLoaded();
        }
      }),
      events.on(projectSettingsChangedChannel, ({ projectId }) => {
        if (projectId === this.projectId) this.reloadIfLoaded();
      })
    );
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
    await this.watchConfig();
    if (this._disposed) return;
    await this.reload();
  }

  private reloadIfLoaded(): void {
    if (!this._loaded || this._disposed) return;
    void this.reload();
  }

  private async watchConfig(): Promise<void> {
    if (this._watchingConfig || this._disposed) return;
    try {
      await rpc.fs.watchSetPaths(this.projectId, this.workspaceId, [''], 'lifecycle-scripts');
      if (this._disposed) {
        void rpc.fs.watchStop(this.projectId, this.workspaceId, 'lifecycle-scripts');
        return;
      }
      this._watchingConfig = true;
    } catch {
      this._watchingConfig = false;
    }
  }

  private async reload(): Promise<void> {
    if (this._disposed) return;
    const refreshSeq = ++this._refreshSeq;
    const settings = await rpc.projectSettings.getSettings(this.workspaceId);
    if (this._disposed) return;

    const entries: { type: ScriptType; command: string; label: string }[] = [];
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
          const store = new LifecycleScriptStore(data, this.projectId, this.workspaceId);
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
    if (this._watchingConfig) {
      void rpc.fs.watchStop(this.projectId, this.workspaceId, 'lifecycle-scripts');
    }
    for (const script of this.scripts.values()) {
      script.dispose();
    }
    this.scripts.clear();
    this.tabOrder = [];
    this.activeTabId = undefined;
  }
}
