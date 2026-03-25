import { makeAutoObservable } from 'mobx';
import { Task } from '@shared/tasks';
import { ConversationManagerStore } from './conversation-manager';
import { DiffViewStore } from './diff-view-store';
import { FilesStore } from './files-store';
import { GitStore } from './git';
import { LifecycleScriptsStore } from './lifecycle-scripts';
import { TerminalManagerStore } from './terminal-manager';

type UnregisteredTaskPhase = 'creating' | 'create-error';

export type UnregisteredTaskData = {
  id: string;
  name: string;
};

export class UnregisteredTaskStore {
  readonly state = 'unregistered' as const;
  data: UnregisteredTaskData;
  phase: UnregisteredTaskPhase = 'creating';
  errorMessage: string | undefined = undefined;

  constructor(data: UnregisteredTaskData) {
    this.data = data;
    makeAutoObservable(this);
  }
}

type UnprovisionedTaskPhase =
  | 'provision'
  | 'provision-error'
  | 'teardown'
  | 'teardown-error'
  | 'idle';

export class UnprovisionedTaskStore {
  readonly state = 'unprovisioned' as const;
  phase: UnprovisionedTaskPhase = 'idle';
  data: Task;
  errorMessage: string | undefined = undefined;

  constructor(task: Task) {
    this.data = task;
    makeAutoObservable(this);
  }
}

export class ProvisionedTaskStore {
  readonly state = 'provisioned' as const;
  data: Task;
  terminals: TerminalManagerStore;
  conversations: ConversationManagerStore;
  git: GitStore;
  lifecycleScripts: LifecycleScriptsStore;
  files: FilesStore;
  diffView: DiffViewStore;

  constructor(task: Task) {
    this.data = task;
    this.terminals = new TerminalManagerStore(task.projectId, task.id);
    this.conversations = new ConversationManagerStore(task.projectId, task.id);
    this.git = new GitStore(task.projectId, task.id);
    this.files = new FilesStore(task.projectId, task.id);
    this.lifecycleScripts = new LifecycleScriptsStore();
    this.diffView = new DiffViewStore(this.git);
    makeAutoObservable(this, { diffView: false });
  }

  activate(): void {
    void this.git.load();
    this.git.startWatching();
    void this.files.loadRoot();
    this.files.startWatching();
  }

  dispose(): void {
    this.git.dispose();
    this.files.dispose();
    this.diffView.dispose();
    for (const conv of this.conversations.conversations.values()) {
      conv.dispose();
    }
    for (const term of this.terminals.terminals.values()) {
      term.dispose();
    }
  }

  async rename(_name: string) {
    // TODO: implement
  }
}

export type TaskStore = UnprovisionedTaskStore | ProvisionedTaskStore | UnregisteredTaskStore;
