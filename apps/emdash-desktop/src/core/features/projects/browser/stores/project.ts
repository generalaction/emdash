import type { WorkspaceOperationProgress } from '@emdash/core/runtimes/workspace/api';
import { makeAutoObservable, observable } from 'mobx';
import { type ProjectScopedStoreContext } from '@core/features/projects/contributions/project-stores';
import { projectSubject } from '@core/features/projects/contributions/subject';
import { projectStoreContributions } from '@core/manifests/browser/project-scoped-stores';
import type { SubjectSpace } from '@core/primitives/mementos/browser';
import type { LocalProject, SshProject } from '@core/primitives/projects/api';
import {
  ScopedStoreHost,
  type ScopedStoreToken,
  type ScopedStoreValue,
} from '@core/primitives/scoped-stores/browser';
import { getMementoClient } from '@renderer/lib/mementos';

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
 * lifecycle transitions. Transitioning replaces `mountedProject` atomically
 * rather than nulling out individual fields.
 */
export class ProjectStore {
  state: 'unregistered' | 'unmounted' | 'mounted';
  id: string;
  name: string | null;
  data: LocalProject | SshProject | null;
  createdAt: string;
  phase: UnregisteredProjectPhase | UnmountedProjectPhase | null;
  error: string | undefined = undefined;
  progressMessage: string | undefined = undefined;
  operation: WorkspaceOperationProgress | undefined = undefined;
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
    this.createdAt = data?.createdAt ?? new Date().toISOString();
    this.phase = phase;
    this.mode = mode;
    makeAutoObservable(this, { mountedProject: observable.ref });
  }

  transitionToMounted(mountedProject: MountedProject): void {
    this.mountedProject = mountedProject;
    this.data = mountedProject.data;
    this.id = mountedProject.data.id;
    this.name = mountedProject.data.name;
    this.createdAt = mountedProject.data.createdAt;
    this.state = 'mounted';
    this.phase = null;
    this.error = undefined;
    this.progressMessage = undefined;
    this.operation = undefined;
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
    this.createdAt = data.createdAt;
    this.state = 'unmounted';
    this.phase = phase;
    this.error = undefined;
    this.progressMessage = undefined;
    this.operation = undefined;
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
    this.progressMessage = undefined;
    this.operation = undefined;
  }
}

export type UnregisteredProject = ProjectStore & {
  state: 'unregistered';
  id: string;
  name: string;
  phase: UnregisteredProjectPhase;
  mode: ProjectMode;
  error: string | undefined;
  progressMessage: string | undefined;
  operation: WorkspaceOperationProgress | undefined;
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
