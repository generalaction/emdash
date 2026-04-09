import { action, computed, makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import { makePtySessionId } from '@shared/ptySessionId';
import { createScriptTerminalId } from '@shared/terminals';
import { rpc } from '@renderer/core/ipc';
import { TabViewProvider } from '@renderer/core/stores/generic-tab-view';
import {
  addTabId,
  setNextTabActive,
  setPreviousTabActive,
  setTabActive,
  setTabActiveIndex,
} from '@renderer/core/stores/tab-utils';
import { PtySession } from './pty-session';

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

  constructor(data: LifecycleScriptData, projectId: string, workspaceId: string) {
    this.data = data;
    this.session = new PtySession(makePtySessionId(projectId, workspaceId, data.id));
    makeObservable(this, { data: observable, session: observable });
  }

  dispose() {
    this.session.dispose();
  }
}

export class LifecycleScriptsStore implements TabViewProvider<LifecycleScriptStore, never> {
  private readonly projectId: string;
  private readonly workspaceId: string;
  private _loaded = false;
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
    this._loaded = true;
    const settings = await rpc.tasks.getWorkspaceSettings(this.projectId, this.workspaceId);

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

    const resolved = await Promise.all(
      entries.map(async (entry) => {
        const id = await createScriptTerminalId({
          projectId: this.projectId,
          scopeId: this.workspaceId,
          type: entry.type,
          script: entry.command,
        });
        return { ...entry, id };
      })
    );

    runInAction(() => {
      for (const entry of resolved) {
        const store = new LifecycleScriptStore(
          { id: entry.id, type: entry.type, label: entry.label, command: entry.command },
          this.projectId,
          this.workspaceId
        );
        this.scripts.set(entry.id, store);
        addTabId(this, entry.id);
        void store.session.connect();
      }
      if (!this.activeTabId && this.tabOrder.length > 0) {
        this.activeTabId = this.tabOrder[0];
      }
    });
  }

  dispose(): void {
    for (const script of this.scripts.values()) {
      script.dispose();
    }
    this.scripts.clear();
    this.tabOrder = [];
    this.activeTabId = undefined;
  }
}
