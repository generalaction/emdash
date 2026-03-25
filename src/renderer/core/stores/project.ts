import { makeAutoObservable } from 'mobx';
import type { LocalProject, SshProject } from '@shared/projects';
import { TaskManagerStore } from './task-manager';

export type UnregisteredProjectPhase =
  | 'creating-repo' // gh api — new mode only
  | 'cloning' // git clone
  | 'registering' // db insert
  | 'error';

export class UnregisteredProjectStore {
  readonly state = 'unregistered' as const;
  id: string;
  name: string;
  mode: 'pick' | 'clone' | 'new';
  phase: UnregisteredProjectPhase;
  error: string | undefined = undefined;

  constructor(
    id: string,
    name: string,
    phase: UnregisteredProjectPhase,
    mode: 'pick' | 'clone' | 'new' = 'pick'
  ) {
    this.id = id;
    this.name = name;
    this.mode = mode;
    this.phase = phase;
    makeAutoObservable(this);
  }
}

export type UnmountedProjectPhase = 'opening' | 'error' | 'closing' | 'idle';

export class UnmountedProjectStore {
  readonly state = 'unmounted' as const;
  phase: UnmountedProjectPhase = 'idle';
  data: LocalProject | SshProject;
  error: string | undefined = undefined;

  constructor(data: LocalProject | SshProject, phase: UnmountedProjectPhase = 'opening') {
    this.data = data;
    this.phase = phase;
    makeAutoObservable(this);
  }
}

export class MountedProjectStore {
  readonly state = 'mounted' as const;
  data: LocalProject | SshProject;
  taskManager: TaskManagerStore;

  // add project settings store

  constructor(data: LocalProject | SshProject) {
    this.data = data;
    this.taskManager = new TaskManagerStore(data.id);
    makeAutoObservable(this);
  }

  async rename(_name: string) {
    // TODO: implement rpc.projects.renameProject
  }
}

export type ProjectStore = UnregisteredProjectStore | UnmountedProjectStore | MountedProjectStore;
