import { makeAutoObservable, runInAction } from 'mobx';
import { Issue, Task } from '@shared/tasks';
import type { TaskViewSnapshot } from '@shared/view-state';
import { rpc } from '../ipc';
import { MainPanelView, RightPanelView } from '../tasks/types';
import { ConversationManagerStore } from './conversation-manager';
import { DevServerStore } from './dev-server-store';
import { DiffViewStore } from './diff-view-store';
import { EditorViewStore } from './editor-view-store';
import { FilesStore } from './files-store';
import { GitStore } from './git';
import { LifecycleScriptsStore } from './lifecycle-scripts';
import { PrStore } from './pr-store';
import { snapshotRegistry } from './snapshot-registry';
import { TerminalManagerStore } from './terminal-manager';

export type UnregisteredTaskPhase = 'creating' | 'create-error';

export type UnprovisionedTaskPhase =
  | 'provision'
  | 'provision-error'
  | 'teardown'
  | 'teardown-error'
  | 'idle';

export type UnregisteredTaskData = {
  id: string;
  name: string;
};

export interface IUnregisteredTask {
  readonly state: 'unregistered';
  data: UnregisteredTaskData;
  phase: UnregisteredTaskPhase;
  errorMessage: string | undefined;
}

export interface IUnprovisionedTask {
  readonly state: 'unprovisioned';
  data: Task;
  phase: UnprovisionedTaskPhase;
  errorMessage: string | undefined;
}

export interface IProvisionedTask {
  readonly state: 'provisioned';
  data: Task;
  path: string;
  terminals: TerminalManagerStore;
  conversations: ConversationManagerStore;
  git: GitStore;
  files: FilesStore;
  lifecycleScripts: LifecycleScriptsStore;
  diffView: DiffViewStore;
  devServers: DevServerStore;
  pr: PrStore;
  view: MainPanelView;
  rightPanelView: RightPanelView;
  focusedRegion: 'main' | 'right';
  editorView: EditorViewStore;
  updateLinkedIssue: (issue?: Issue) => Promise<void>;
}

// Single mutable TaskStore class
export class TaskStore {
  state: 'unregistered' | 'unprovisioned' | 'provisioned';
  data: UnregisteredTaskData | Task;
  path: string | null = null;
  phase: UnregisteredTaskPhase | UnprovisionedTaskPhase | null;
  errorMessage: string | undefined = undefined;

  // Provisioned-only sub-stores — null until transitionToProvisioned
  terminals: TerminalManagerStore | null = null;
  conversations: ConversationManagerStore | null = null;
  git: GitStore | null = null;
  files: FilesStore | null = null;
  lifecycleScripts: LifecycleScriptsStore | null = null;
  diffView: DiffViewStore | null = null;
  devServers: DevServerStore | null = null;
  pr: PrStore | null = null;

  // View state — populated once provisioned
  view: MainPanelView | null = null;
  rightPanelView: RightPanelView | null = null;
  focusedRegion: 'main' | 'right' = 'main';
  editorView: EditorViewStore | null = null;

  private _snapshotDisposer: (() => void) | null = null;

  get snapshot(): TaskViewSnapshot {
    return {
      view: this.view,
      rightPanelView: this.rightPanelView,
      focusedRegion: this.focusedRegion,
      conversations: this.conversations?.snapshot,
      terminals: this.terminals?.snapshot,
      editor: this.editorView?.snapshot,
      diffView: this.diffView?.snapshot,
    };
  }

  constructor(
    data: UnregisteredTaskData | Task,
    state: TaskStore['state'],
    phase: UnregisteredTaskPhase | UnprovisionedTaskPhase | null = null
  ) {
    this.state = state;
    this.data = data;
    this.phase = phase;
    makeAutoObservable(this, { diffView: false });
  }

  transitionToProvisioned(data: Task, path: string, savedSnapshot?: TaskViewSnapshot): void {
    this.terminals = new TerminalManagerStore(data.projectId, data.id);
    this.conversations = new ConversationManagerStore(data.projectId, data.id);
    this.git = new GitStore(data.projectId, data.id);
    this.files = new FilesStore(data.projectId, data.id);
    this.lifecycleScripts = new LifecycleScriptsStore(data.projectId, data.id);
    this.pr = new PrStore(data.projectId, data.id, this.git);
    this.diffView = new DiffViewStore(this.git, this.pr);
    this.devServers = new DevServerStore(data.id);
    this.editorView = new EditorViewStore(data.projectId, data.id);

    // Apply saved snapshot before registering the reaction so the initial
    // state doesn't trigger a spurious write.
    if (savedSnapshot) {
      this.view = (savedSnapshot.view as MainPanelView) ?? 'agents';
      this.rightPanelView = (savedSnapshot.rightPanelView as RightPanelView) ?? 'changes';
      this.focusedRegion = savedSnapshot.focusedRegion ?? 'main';
      this.conversations.restoreSnapshot(savedSnapshot.conversations ?? {});
      this.terminals.restoreSnapshot(savedSnapshot.terminals ?? {});
      this.editorView.restoreSnapshot(savedSnapshot.editor ?? {});
      this.diffView.restoreSnapshot(savedSnapshot.diffView ?? {});
    } else {
      this.view = 'agents';
      this.rightPanelView = 'changes';
      this.focusedRegion = 'main';
    }

    this._snapshotDisposer = snapshotRegistry.register(`task:${data.id}`, () => this.snapshot);

    this.data = data;
    this.state = 'provisioned';
    this.path = path;
    this.phase = null;
    this.errorMessage = undefined;
  }

  transitionToUnprovisioned(data: Task, phase: UnprovisionedTaskPhase = 'idle'): void {
    this._snapshotDisposer?.();
    this._snapshotDisposer = null;
    this._disposeSubStores();
    this.terminals = null;
    this.conversations = null;
    this.git = null;
    this.files = null;
    this.lifecycleScripts = null;
    this.diffView = null;
    this.devServers = null;
    this.pr = null;
    this.view = null;
    this.rightPanelView = null;
    this.editorView = null;
    this.data = data;
    this.state = 'unprovisioned';
    this.phase = phase;
    this.errorMessage = undefined;
  }

  transitionToUnregistered(data: UnregisteredTaskData): void {
    this._snapshotDisposer?.();
    this._snapshotDisposer = null;
    this._disposeSubStores();
    this.terminals = null;
    this.conversations = null;
    this.git = null;
    this.files = null;
    this.lifecycleScripts = null;
    this.diffView = null;
    this.devServers = null;
    this.pr = null;
    this.view = null;
    this.rightPanelView = null;
    this.editorView = null;
    this.data = data;
    this.state = 'unregistered';
    this.phase = 'creating';
    this.errorMessage = undefined;
  }

  activate(): void {
    this.git!.startWatching();
    this.files!.startWatching();
    this.pr!.start();
    this.editorView!.initialize();
  }

  dispose(): void {
    this._disposeSubStores();
  }

  setView(v: MainPanelView): void {
    this.view = v;
  }

  setRightPanelView(v: RightPanelView): void {
    this.rightPanelView = v;
  }

  setFocusedRegion(region: 'main' | 'right'): void {
    this.focusedRegion = region;
  }

  async rename(name: string) {
    const task = isProvisioned(this) ? this.data : undefined;
    if (task) {
      try {
        await rpc.tasks.renameTask(task.projectId, task.id, name);
        runInAction(() => {
          this.data.name = name;
        });
      } catch (e) {
        runInAction(() => {
          this.data.name = task.name;
        });
        console.error(e);
        throw e;
      }
    }
  }

  async updateLinkedIssue(issue?: Issue) {
    const task = isProvisioned(this) ? this.data : undefined;
    if (task) {
      try {
        await rpc.tasks.updateLinkedIssue(task.id, issue);
        runInAction(() => {
          if (isProvisioned(this)) {
            this.data.linkedIssue = issue;
          }
        });
      } catch (e) {
        runInAction(() => {
          if (isProvisioned(this)) {
            this.data.linkedIssue = task.linkedIssue;
          }
        });
        console.error(e);
        throw e;
      }
    }
  }

  private _disposeSubStores(): void {
    this.editorView?.dispose();
    this.git?.dispose();
    this.files?.dispose();
    this.diffView?.dispose();
    this.devServers?.dispose();
    this.pr?.dispose();
    if (this.conversations) {
      for (const conv of this.conversations.conversations.values()) {
        conv.dispose();
      }
    }
    if (this.terminals) {
      for (const term of this.terminals.terminals.values()) {
        term.dispose();
      }
    }
  }
}

export type UnregisteredTask = TaskStore & IUnregisteredTask;
export type UnprovisionedTask = TaskStore & IUnprovisionedTask;
export type ProvisionedTask = TaskStore & IProvisionedTask;

export function isUnregistered(t: TaskStore): t is UnregisteredTask {
  return t.state === 'unregistered';
}

export function isRegistered(t: TaskStore): t is UnprovisionedTask | ProvisionedTask {
  return t.state !== 'unregistered';
}

export function isUnprovisioned(t: TaskStore): t is UnprovisionedTask {
  return t.state === 'unprovisioned';
}

export function isProvisioned(t: TaskStore): t is ProvisionedTask {
  return t.state === 'provisioned';
}

export function createUnregisteredTask(data: UnregisteredTaskData): TaskStore {
  return new TaskStore(data, 'unregistered', 'creating');
}

export function createUnprovisionedTask(data: Task): TaskStore {
  return new TaskStore(data, 'unprovisioned', 'idle');
}
