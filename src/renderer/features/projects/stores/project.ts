import { makeAutoObservable, observable } from 'mobx';
import type { LocalProject, SshProject } from '@shared/projects';
import type { ProjectViewSnapshot } from '@shared/view-state';
import { TaskManagerStore } from '@renderer/features/tasks/stores/task-manager';
import { snapshotRegistry } from '@renderer/lib/stores/snapshot-registry';
import { PrSyncStore } from './pr-sync-store';
import { ProjectSettingsStore } from './project-settings-store';
import { ProjectViewStore } from './project-view';
import { RepositoryStore } from './repository-store';

export type UnregisteredProjectPhase =
  | 'creating-repo' // gh api — new mode only
  | 'cloning' // git clone
  | 'registering' // db insert
  | 'error';

export type UnmountedProjectPhase = 'opening' | 'error' | 'closing' | 'idle';

export type ProjectMode = 'pick' | 'clone' | 'new';

/**
 * Holds all mounted-only state for a project. Created atomically by
 * ProjectStore.transitionToMounted and disposed on unmount or deletion.
 */
export class MountedProject {
  readonly taskManager: TaskManagerStore;
  readonly view: ProjectViewStore;
  readonly settings: ProjectSettingsStore;
  readonly repository: RepositoryStore;
  readonly prSync: PrSyncStore;
  readonly data: LocalProject | SshProject;

  private _snapshotDisposer: (() => void) | null = null;

  get snapshot(): ProjectViewSnapshot {
    return {
      activeView: this.view.activeView,
      taskViewTab: this.view.taskView.tab,
    };
  }

  constructor(data: LocalProject | SshProject, savedSnapshot?: ProjectViewSnapshot) {
    this.data = data;
    this.view = new ProjectViewStore();
    this.settings = new ProjectSettingsStore(data.id);
    this.repository = new RepositoryStore(data.id, this.settings, data.baseRef);
    this.prSync = new PrSyncStore(data.id);
    this.taskManager = new TaskManagerStore(data.id, this.repository, this.settings, data.baseRef);

    if (savedSnapshot) this.view.restoreSnapshot(savedSnapshot);

    makeAutoObservable(this, {
      taskManager: false,
      view: false,
      settings: false,
      repository: false,
      prSync: false,
    });

    this._snapshotDisposer = snapshotRegistry.register(`project:${data.id}`, () => this.snapshot);
  }

  dispose(): void {
    this.repository.dispose();
    this.prSync.dispose();
    this.settings.dispose();
    this._snapshotDisposer?.();
    this._snapshotDisposer = null;
  }
}

/**
 * Container class — holds a stable reference in the ObservableMap across all
 * lifecycle transitions. Transitioning replaces `mountedProject` atomically
 * rather than nulling out individual fields.
 */
export class ProjectStore {
  state: 'unregistered' | 'unmounted' | 'mounted';
  id: string;
  name: string | null;
  data: LocalProject | SshProject | null;
  phase: UnregisteredProjectPhase | UnmountedProjectPhase | null;
  error: string | undefined = undefined;
  errorCode: 'path-not-found' | 'ssh-disconnected' | undefined = undefined;
  mode: ProjectMode | null;
  mountedProject: MountedProject | null = null;

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
    makeAutoObservable(this, { mountedProject: observable.ref });
  }

  transitionToMounted(data: LocalProject | SshProject, savedSnapshot?: ProjectViewSnapshot): void {
    this.mountedProject = new MountedProject(data, savedSnapshot);
    this.data = data;
    this.id = data.id;
    this.name = data.name;
    this.state = 'mounted';
    this.phase = null;
    this.error = undefined;
    this.errorCode = undefined;
  }

  transitionToUnmounted(
    data: LocalProject | SshProject,
    phase: UnmountedProjectPhase = 'opening'
  ): void {
    this.mountedProject?.dispose();
    this.mountedProject = null;
    this.data = data;
    this.id = data.id;
    this.name = data.name;
    this.state = 'unmounted';
    this.phase = phase;
    this.error = undefined;
    this.errorCode = undefined;
  }

  transitionToUnregistered(
    id: string,
    name: string,
    phase: UnregisteredProjectPhase,
    mode: ProjectMode
  ): void {
    this.mountedProject?.dispose();
    this.mountedProject = null;
    this.data = null;
    this.id = id;
    this.name = name;
    this.state = 'unregistered';
    this.phase = phase;
    this.mode = mode;
    this.error = undefined;
  }
}

export type UnregisteredProject = ProjectStore & {
  state: 'unregistered';
  id: string;
  name: string;
  phase: UnregisteredProjectPhase;
  mode: ProjectMode;
  error: string | undefined;
};

export type UnmountedProject = ProjectStore & {
  state: 'unmounted';
  data: LocalProject | SshProject;
  phase: UnmountedProjectPhase;
  error: string | undefined;
  errorCode: 'path-not-found' | 'ssh-disconnected' | undefined;
};

export function isUnregisteredProject(p: ProjectStore): p is UnregisteredProject {
  return p.state === 'unregistered';
}

export function isUnmountedProject(p: ProjectStore): p is UnmountedProject {
  return p.state === 'unmounted';
}

export function isMountedProject(p: ProjectStore): p is ProjectStore & {
  state: 'mounted';
  mountedProject: MountedProject;
  data: LocalProject | SshProject;
} {
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
