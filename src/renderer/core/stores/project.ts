import { makeAutoObservable } from 'mobx';
import type { LocalProject, SshProject } from '@shared/projects';
import { rpc } from '../ipc';
import { ProjectViewStore } from './project-view';
import { TaskManagerStore } from './task-manager';

export type UnregisteredProjectPhase =
  | 'creating-repo' // gh api — new mode only
  | 'cloning' // git clone
  | 'registering' // db insert
  | 'error';

export type UnmountedProjectPhase = 'opening' | 'error' | 'closing' | 'idle';

export type ProjectMode = 'pick' | 'clone' | 'new';

export interface IUnregisteredProject {
  readonly state: 'unregistered';
  id: string;
  name: string;
  phase: UnregisteredProjectPhase;
  mode: ProjectMode;
  error: string | undefined;
}

export interface IUnmountedProject {
  readonly state: 'unmounted';
  data: LocalProject | SshProject;
  phase: UnmountedProjectPhase;
  error: string | undefined;
}

export interface IMountedProject {
  readonly state: 'mounted';
  data: LocalProject | SshProject;
  taskManager: TaskManagerStore;
  view: ProjectViewStore;
  rename: (name: string) => Promise<void>;
}

export class ProjectStore {
  state: 'unregistered' | 'unmounted' | 'mounted';
  id: string;
  name: string | null;
  data: LocalProject | SshProject | null;
  phase: UnregisteredProjectPhase | UnmountedProjectPhase | null;
  error: string | undefined = undefined;
  mode: ProjectMode | null;
  taskManager: TaskManagerStore | null = null;
  view: ProjectViewStore | null = null;

  constructor(
    state: ProjectStore['state'],
    id: string,
    name: string | null,
    data: LocalProject | SshProject | null,
    phase: UnregisteredProjectPhase | UnmountedProjectPhase | null,
    mode: ProjectMode | null = null
  ) {
    this.state = state;
    this.id = id;
    this.name = name;
    this.data = data;
    this.phase = phase;
    this.mode = mode;
    makeAutoObservable(this);
  }

  transitionToMounted(data: LocalProject | SshProject): void {
    this.taskManager = new TaskManagerStore(data.id);
    this.data = data;
    this.id = data.id;
    this.name = data.name;
    this.state = 'mounted';
    this.phase = null;
    this.error = undefined;
    this.view = new ProjectViewStore();
  }

  transitionToUnmounted(
    data: LocalProject | SshProject,
    phase: UnmountedProjectPhase = 'opening'
  ): void {
    this.taskManager = null;
    this.data = data;
    this.id = data.id;
    this.name = data.name;
    this.state = 'unmounted';
    this.phase = phase;
    this.error = undefined;
  }

  transitionToUnregistered(
    id: string,
    name: string,
    phase: UnregisteredProjectPhase,
    mode: ProjectMode
  ): void {
    this.taskManager = null;
    this.data = null;
    this.id = id;
    this.name = name;
    this.state = 'unregistered';
    this.phase = phase;
    this.mode = mode;
    this.error = undefined;
  }

  async rename(name: string) {
    try {
      await rpc.projects.renameProject({ projectId: this.id, name: name });
      this.name = name;
      if (this.data) this.data.name = name;
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
}

export type UnregisteredProject = ProjectStore & IUnregisteredProject;
export type UnmountedProject = ProjectStore & IUnmountedProject;
export type MountedProject = ProjectStore & IMountedProject;

export function isUnregisteredProject(p: ProjectStore): p is UnregisteredProject {
  return p.state === 'unregistered';
}

export function isUnmountedProject(p: ProjectStore): p is UnmountedProject {
  return p.state === 'unmounted';
}

export function isMountedProject(p: ProjectStore): p is MountedProject {
  return p.state === 'mounted';
}

export function createUnregisteredProject(
  id: string,
  name: string,
  phase: UnregisteredProjectPhase,
  mode: ProjectMode = 'pick'
): ProjectStore {
  return new ProjectStore('unregistered', id, name, null, phase, mode);
}

export function createUnmountedProject(
  data: LocalProject | SshProject,
  phase: UnmountedProjectPhase = 'opening'
): ProjectStore {
  return new ProjectStore('unmounted', data.id, data.name, data, phase);
}
