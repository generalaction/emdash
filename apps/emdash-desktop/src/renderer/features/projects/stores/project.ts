import { projectViewMemento } from '@core/features/projects/contributions/mementos';
import { projectSubject } from '@core/features/projects/contributions/subject';
import type { SubjectSpace } from '@core/primitives/mementos/browser';
import type { WorkspaceOperationProgress } from '@emdash/core/runtimes/workspace/api';
import { makeAutoObservable, observable } from 'mobx';
import { TaskManagerStore } from '@renderer/features/tasks/stores/task-manager';
import { getMementoClient } from '@renderer/lib/mementos';
import type { LocalProject, SshProject } from '@shared/projects';
import { GitRepositoryStore } from './git-repository-store';
import { ProjectSettingsStore } from './project-settings-store';
import { ProjectViewStore } from './project-view';

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
  readonly gitRepository: GitRepositoryStore;
  readonly data: LocalProject | SshProject;
  readonly space: SubjectSpace<'project'>;

  constructor(data: LocalProject | SshProject) {
    this.data = data;
    this.space = getMementoClient().subject(projectSubject({ projectId: data.id }));
    this.view = new ProjectViewStore(this.space.handle(projectViewMemento));
    this.settings = new ProjectSettingsStore(
      data.id,
      data.type === 'local' ? data.path : undefined
    );
    this.gitRepository = new GitRepositoryStore(data.id, data.path, this.settings, data.baseRef);
    this.gitRepository.start();
    this.taskManager = new TaskManagerStore(data.id, this.gitRepository, this.settings);

    makeAutoObservable(this, {
      taskManager: false,
      view: false,
      settings: false,
      gitRepository: false,
      space: false,
    });
  }

  dispose(): void {
    this.taskManager.dispose();
    this.gitRepository.dispose();
    this.settings.dispose();
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
