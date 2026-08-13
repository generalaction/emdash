import { runtimeHostUnavailable } from '@emdash/core/primitives/runtime-resolution/api';
import { err } from '@emdash/shared';
import { makeAutoObservable, observable } from 'mobx';
import { getProjectsWireClient } from '@core/features/projects/api/browser/client';
import type {
  ProjectContextLifecycle,
  ProjectHostAccess,
} from '@core/features/projects/api/browser/stores/project-context';
import { type ProjectScopedStoreContext } from '@core/features/projects/contributions/project-stores';
import { projectSubject } from '@core/features/projects/contributions/subject';
import { projectStoreContributions } from '@core/manifests/browser/project-scoped-stores';
import type { SubjectSpace } from '@core/primitives/mementos/browser';
import { getMementoClient } from '@core/primitives/mementos/browser';
import { projectHostRef, type LocalProject, type SshProject } from '@core/primitives/projects/api';
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
  | {
      kind: 'failed';
      message: string;
      code?: 'path-not-found' | 'ssh-disconnected';
    };

export type ProjectMode = 'pick' | 'clone' | 'new';

function legacyMountHostAccess(project: LocalProject | SshProject): ProjectHostAccess {
  const state = { kind: 'offline' as const };
  return Object.freeze({
    state,
    liveAction: { kind: 'disabled' as const, state },
    requireLive: () =>
      err(runtimeHostUnavailable(projectHostRef(project), 'offline', 'Host is offline')),
    recover: async () =>
      (await getProjectsWireClient()).recoverAttachment({ projectId: project.id }),
  });
}

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
    this.stores = new ScopedStoreHost(
      { data, space: this.space, host: legacyMountHostAccess(data) },
      projectStoreContributions
    );
    this.stores.activate();

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
  context: ProjectContextLifecycle | null = null;

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
      context: observable.ref,
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
    this.mode = null;
  }

  updateData(data: LocalProject | SshProject): void {
    if (!this.data) throw new Error(`Cannot update unregistered project ${this.id}`);
    if (data.id !== this.id) {
      throw new Error(`Cannot change project identity from ${this.id} to ${data.id}`);
    }
    if (data.type !== this.data.type) {
      throw new Error(
        `Cannot change project ${this.id} type from ${this.data.type} to ${data.type}`
      );
    }

    Object.assign(this.data, data);
    this.name = data.name;
    this.createdAt = data.createdAt;
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
    this.mode = null;
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
