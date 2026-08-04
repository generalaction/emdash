import { makeAutoObservable, observable } from 'mobx';
import { type ProjectScopedStoreContext } from '@core/features/projects/contributions/project-stores';
import { projectSubject } from '@core/features/projects/contributions/subject';
import { projectStoreContributions } from '@core/manifests/browser/project-scoped-stores';
import type { SubjectSpace } from '@core/primitives/mementos/browser';
import { getMementoClient } from '@core/primitives/mementos/browser';
import type { LocalProject, SshProject } from '@core/primitives/projects/api';
import {
  ScopedStoreHost,
  type ScopedStoreToken,
  type ScopedStoreValue,
} from '@core/primitives/scoped-stores/browser';

export type ProjectCreationStage = 'creating-repo' | 'cloning' | 'registering';

export type CreationStatus =
  | {
      kind: 'running';
      stage: ProjectCreationStage;
      progressMessage?: string;
      progressPercent?: number;
    }
  | { kind: 'failed'; stage: ProjectCreationStage; message: string };

export type UnmountedStatus =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'closing' }
  | {
      kind: 'failed';
      message: string;
      code?: 'path-not-found' | 'ssh-disconnected';
    };

export type ProjectMode = 'pick' | 'clone' | 'new';

/**
 * Holds all mounted-only state for a project. Created atomically by
 * ProjectStore.transitionToMounted and disposed on unmount or deletion.
 */
export class MountedProject {
  readonly data: LocalProject | SshProject;
  readonly space: SubjectSpace<'project'>;
  private readonly stores: ScopedStoreHost<ProjectScopedStoreContext>;

  get<Token extends ScopedStoreToken<unknown>>(token: Token): ScopedStoreValue<Token> {
    return this.stores.get(token);
  }

  constructor(data: LocalProject | SshProject) {
    this.data = data;
    this.space = getMementoClient().subject(projectSubject({ projectId: data.id }));
    this.stores = new ScopedStoreHost({ data, space: this.space }, projectStoreContributions);

    makeAutoObservable<MountedProject, 'stores'>(this, {
      space: false,
      stores: false,
    });
  }

  dispose(): void {
    this.stores.dispose();
    void this.space.release().catch((error: unknown) => getMementoClient().reportError(error));
  }
}

/**
 * Container class — holds a stable reference in the ObservableMap across all
 * lifecycle transitions. Transitioning replaces each state's payload atomically.
 */
export class ProjectStore {
  state: 'unregistered' | 'unmounted' | 'mounted';
  id: string;
  name: string | null;
  data: LocalProject | SshProject | null;
  createdAt: string;
  creation: CreationStatus | null;
  unmounted: UnmountedStatus | null;
  mode: ProjectMode | null;
  mountedProject: MountedProject | null = null;

  constructor(
    state: ProjectStore['state'],
    id: string,
    name: string | null,
    data: LocalProject | SshProject | null,
    creation: CreationStatus | null,
    unmounted: UnmountedStatus | null,
    mode: ProjectMode | null = null
  ) {
    this.state = state;
    this.id = id;
    this.name = name;
    this.data = data;
    this.createdAt = data?.createdAt ?? new Date().toISOString();
    this.creation = creation;
    this.unmounted = unmounted;
    this.mode = mode;
    makeAutoObservable(this, {
      creation: observable.ref,
      mountedProject: observable.ref,
      unmounted: observable.ref,
    });
  }

  transitionToMounted(mountedProject: MountedProject): void {
    this.mountedProject = mountedProject;
    this.data = mountedProject.data;
    this.id = mountedProject.data.id;
    this.name = mountedProject.data.name;
    this.createdAt = mountedProject.data.createdAt;
    this.state = 'mounted';
    this.creation = null;
    this.unmounted = null;
  }

  transitionToUnmounted(
    data: LocalProject | SshProject,
    unmounted: UnmountedStatus = { kind: 'opening' }
  ): void {
    this.mountedProject?.dispose();
    this.mountedProject = null;
    this.data = data;
    this.id = data.id;
    this.name = data.name;
    this.createdAt = data.createdAt;
    this.state = 'unmounted';
    this.creation = null;
    this.unmounted = unmounted;
  }

  transitionToUnregistered(
    id: string,
    name: string,
    creation: CreationStatus,
    mode: ProjectMode
  ): void {
    this.mountedProject?.dispose();
    this.mountedProject = null;
    this.data = null;
    this.id = id;
    this.name = name;
    this.state = 'unregistered';
    this.creation = creation;
    this.unmounted = null;
    this.mode = mode;
  }

  updateCreationProgress(
    stage: ProjectCreationStage,
    progress?: { message?: string; percent?: number }
  ): void {
    this.creation = {
      kind: 'running',
      stage,
      progressMessage: progress?.message,
      progressPercent: progress?.percent,
    };
  }

  failCreation(message: string): void {
    if (this.creation === null || this.creation.kind === 'failed') return;
    this.creation = { kind: 'failed', stage: this.creation.stage, message };
  }
}

export type UnregisteredProject = ProjectStore & {
  state: 'unregistered';
  id: string;
  name: string;
  creation: CreationStatus;
  mode: ProjectMode;
};

export type UnmountedProject = ProjectStore & {
  state: 'unmounted';
  data: LocalProject | SshProject;
  unmounted: UnmountedStatus;
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
  creation: CreationStatus,
  mode: ProjectMode = 'pick'
): ProjectStore {
  return new ProjectStore('unregistered', id, name, null, creation, null, mode);
}

export function createUnmountedProject(
  data: LocalProject | SshProject,
  unmounted: UnmountedStatus = { kind: 'opening' }
): ProjectStore {
  return new ProjectStore('unmounted', data.id, data.name, data, null, unmounted);
}
