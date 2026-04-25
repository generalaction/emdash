import { makeObservable, observable, runInAction } from 'mobx';
import { sshConnectionEventChannel } from '@shared/events/sshEvents';
import { LocalProject, SshProject } from '@shared/projects';
import type { ProjectViewSnapshot } from '@shared/view-state';
import { events, rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import {
  createUnmountedProject,
  createUnregisteredProject,
  isMountedProject,
  isUnmountedProject,
  isUnregisteredProject,
  ProjectStore,
  UnregisteredProjectPhase,
} from './project';

interface BaseModeData {
  name: string;
  path: string;
}

export interface PickModeData extends BaseModeData {
  mode: 'pick';
  initGitRepository?: boolean;
}

export interface CloneModeData extends BaseModeData {
  mode: 'clone';
  repositoryUrl: string;
}

export interface NewModeData extends BaseModeData {
  mode: 'new';
  repositoryName: string;
  repositoryOwner: string;
  repositoryVisibility: 'public' | 'private';
}

export type ModeData = PickModeData | CloneModeData | NewModeData;

export type ProjectType = { type: 'local' } | { type: 'ssh'; connectionId: string };

export class ProjectManagerStore {
  projects = observable.map<string, ProjectStore>();
  private _projectMountPromises = new Map<string, Promise<void>>();
  private _loadPromise: Promise<void> | null = null;

  constructor() {
    makeObservable(this, { projects: observable });

    events.on(sshConnectionEventChannel, (event) => {
      if (event.type !== 'connected' && event.type !== 'reconnected') return;
      for (const [projectId, store] of this.projects) {
        if (
          isUnmountedProject(store) &&
          store.errorCode === 'ssh-disconnected' &&
          store.data.type === 'ssh' &&
          store.data.connectionId === event.connectionId
        ) {
          this.mountProject(projectId).catch(() => {});
        }
      }
    });
  }

  load(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = this._doLoad();
    }
    return this._loadPromise;
  }

  private async _doLoad(): Promise<void> {
    const rawProjects = await rpc.projects.getProjects();
    const toMount: string[] = [];
    runInAction(() => {
      for (const p of rawProjects) {
        if (this.projects.has(p.id)) continue;
        this.projects.set(p.id, createUnmountedProject(p, 'idle'));
        toMount.push(p.id);
      }
    });
    await Promise.allSettled(toMount.map((id) => this.mountProject(id)));
  }

  async createProject(
    projectType: ProjectType,
    data: ModeData,
    id?: string
  ): Promise<string | undefined> {
    if (projectType.type === 'local') {
      const existing = await rpc.projects.getLocalProjectByPath(data.path);
      if (existing) return existing.id;
    } else {
      const existing = await rpc.projects.getSshProjectByPath(data.path, projectType.connectionId);
      if (existing) return existing.id;
    }

    const projectId = id ?? crypto.randomUUID();
    const isSsh = projectType.type === 'ssh';
    const projectTelemetryType: 'local' | 'ssh' = isSsh ? 'ssh' : 'local';
    const projectTelemetryStrategy: 'open' | 'create' | 'clone' =
      data.mode === 'clone' ? 'clone' : data.mode === 'new' ? 'create' : 'open';

    switch (data.mode) {
      case 'pick': {
        runInAction(() => {
          this.projects.set(
            projectId,
            createUnregisteredProject(projectId, data.name, 'registering', 'pick')
          );
        });
        try {
          const project = isSsh
            ? await rpc.projects.createSshProject({
                id: projectId,
                path: data.path,
                name: data.name,
                connectionId: projectType.connectionId,
                initGitRepository: data.initGitRepository,
              })
            : await rpc.projects.createLocalProject({
                id: projectId,
                path: data.path,
                name: data.name,
                initGitRepository: data.initGitRepository,
              });
          this._setAndOpenProject(projectId, project);
          captureTelemetry('project_added', {
            type: projectTelemetryType,
            strategy: projectTelemetryStrategy,
            success: true,
          });
        } catch (err) {
          this._markError(projectId, err);
          captureTelemetry('project_added', {
            type: projectTelemetryType,
            strategy: projectTelemetryStrategy,
            success: false,
          });
          throw err;
        }
        break;
      }

      case 'clone': {
        runInAction(() => {
          this.projects.set(
            projectId,
            createUnregisteredProject(projectId, data.name, 'cloning', 'clone')
          );
        });
        try {
          const clonePath = `${data.path}/${data.name}`;
          const connectionId = isSsh ? projectType.connectionId : undefined;
          const cloneResult = await rpc.github.cloneRepository(
            data.repositoryUrl,
            clonePath,
            connectionId
          );
          if (!cloneResult.success) throw new Error(cloneResult.error);
          this._updatePhase(projectId, 'registering');
          const project = isSsh
            ? await rpc.projects.createSshProject({
                id: projectId,
                path: clonePath,
                name: data.name,
                connectionId: projectType.connectionId,
              })
            : await rpc.projects.createLocalProject({
                id: projectId,
                path: clonePath,
                name: data.name,
              });
          this._setAndOpenProject(projectId, project);
          captureTelemetry('project_added', {
            type: projectTelemetryType,
            strategy: projectTelemetryStrategy,
            success: true,
          });
        } catch (err) {
          this._markError(projectId, err);
          captureTelemetry('project_added', {
            type: projectTelemetryType,
            strategy: projectTelemetryStrategy,
            success: false,
          });
          throw err;
        }
        break;
      }

      case 'new': {
        runInAction(() => {
          this.projects.set(
            projectId,
            createUnregisteredProject(projectId, data.name, 'creating-repo', 'new')
          );
        });
        try {
          const connectionId = isSsh ? projectType.connectionId : undefined;
          const repoResult = await rpc.github.createRepository({
            name: data.repositoryName,
            owner: data.repositoryOwner,
            isPrivate: data.repositoryVisibility === 'private',
          });
          if (!repoResult.success || !repoResult.repoUrl) throw new Error(repoResult.error);

          this._updatePhase(projectId, 'cloning');
          const clonePath = `${data.path}/${data.name}`;
          const cloneUrl = `https://github.com/${repoResult.nameWithOwner}.git`;
          const cloneResult = await rpc.github.cloneRepository(cloneUrl, clonePath, connectionId);
          if (!cloneResult.success) throw new Error(cloneResult.error);

          const initResult = await rpc.github.initializeProject({
            targetPath: clonePath,
            name: data.name,
            connectionId,
          });
          if (!initResult.success) throw new Error(initResult.error);

          this._updatePhase(projectId, 'registering');
          const project = isSsh
            ? await rpc.projects.createSshProject({
                id: projectId,
                path: clonePath,
                name: data.name,
                connectionId: projectType.connectionId,
              })
            : await rpc.projects.createLocalProject({
                id: projectId,
                path: clonePath,
                name: data.name,
              });
          this._setAndOpenProject(projectId, project);
          captureTelemetry('project_added', {
            type: projectTelemetryType,
            strategy: projectTelemetryStrategy,
            success: true,
          });
        } catch (err) {
          this._markError(projectId, err);
          captureTelemetry('project_added', {
            type: projectTelemetryType,
            strategy: projectTelemetryStrategy,
            success: false,
          });
          throw err;
        }
        break;
      }
    }

    return projectId;
  }

  mountProject(projectId: string): Promise<void> {
    const inFlight = this._projectMountPromises.get(projectId);
    if (inFlight) return inFlight;

    const project = this.projects.get(projectId);
    if (!project || !isUnmountedProject(project)) return Promise.resolve();

    runInAction(() => {
      project.phase = 'opening';
      project.error = undefined;
      project.errorCode = undefined;
    });

    const promise = Promise.all([
      rpc.projects.openProject(projectId),
      rpc.viewState.get(`project:${projectId}`),
    ])
      .then(async ([openResult, savedSnapshot]) => {
        if (!openResult.success) {
          runInAction(() => {
            const current = this.projects.get(projectId);
            if (current && isUnmountedProject(current)) {
              current.phase = 'error';
              if (openResult.error.type === 'path-not-found') {
                current.error = openResult.error.path;
                current.errorCode = 'path-not-found';
              } else if (openResult.error.type === 'ssh-disconnected') {
                current.error = openResult.error.connectionId;
                current.errorCode = 'ssh-disconnected';
              } else {
                current.error = openResult.error.message;
                current.errorCode = undefined;
              }
            }
          });
          return;
        }
        runInAction(() => {
          const current = this.projects.get(projectId);
          if (current && isUnmountedProject(current)) {
            current.transitionToMounted(
              current.data,
              savedSnapshot as ProjectViewSnapshot | undefined
            );
          }
        });
        // Load the task list before provisioning so the tasks map is populated.
        const taskManager = this.projects.get(projectId)?.mountedProject?.taskManager;
        if (taskManager) {
          await taskManager.loadTasks();
          const nav = appState.navigation;
          const navParams = nav.viewParamsStore['task'] as
            | { projectId?: string; taskId?: string }
            | undefined;
          const navTaskId =
            nav.currentViewId === 'task' && navParams?.projectId === projectId
              ? navParams.taskId
              : undefined;
          if (navTaskId) {
            taskManager.provisionTask(navTaskId).catch(() => {});
          }
        }
      })
      .catch((err: unknown) => {
        runInAction(() => {
          const current = this.projects.get(projectId);
          if (current && isUnmountedProject(current)) {
            current.phase = 'error';
            current.error = err instanceof Error ? err.message : String(err);
            current.errorCode = undefined;
          }
        });
        throw err;
      })
      .finally(() => {
        this._projectMountPromises.delete(projectId);
      });

    this._projectMountPromises.set(projectId, promise);
    return promise;
  }

  async deleteProject(projectId: string): Promise<void> {
    const snapshot = this.projects.get(projectId);
    runInAction(() => {
      this.projects.delete(projectId);
    });
    try {
      await rpc.projects.deleteProject(projectId);
    } catch (err) {
      runInAction(() => {
        if (snapshot) this.projects.set(projectId, snapshot);
      });
      throw err;
    }
  }

  async updateProjectConnection(projectId: string, newConnectionId: string): Promise<void> {
    await rpc.projects.updateProjectConnection(projectId, newConnectionId);

    const store = this.projects.get(projectId);
    if (!store || !store.data || store.data.type !== 'ssh') return;

    const newData: SshProject = { ...store.data, connectionId: newConnectionId };

    runInAction(() => {
      const current = this.projects.get(projectId);
      if (!current || !current.data || current.data.type !== 'ssh') return;
      if (isMountedProject(current)) {
        current.transitionToUnmounted(newData, 'opening');
      } else if (isUnmountedProject(current)) {
        current.data = newData;
        current.phase = 'opening';
        current.error = undefined;
        current.errorCode = undefined;
      }
    });

    // Wait for any existing in-flight mount to settle before attempting a fresh mount
    const inFlight = this._projectMountPromises.get(projectId);
    if (inFlight) await inFlight.catch(() => {});

    this.mountProject(projectId).catch(() => {});
  }

  removeUnregisteredProject(projectId: string): void {
    runInAction(() => {
      const store = this.projects.get(projectId);
      if (store && isUnregisteredProject(store)) {
        this.projects.delete(projectId);
      }
    });
  }

  private _setAndOpenProject(id: string, project: LocalProject | SshProject): void {
    runInAction(() => {
      const current = this.projects.get(id);
      if (current) {
        current.transitionToUnmounted(project, 'opening');
      } else {
        this.projects.set(id, createUnmountedProject(project, 'opening'));
      }
    });
    this.mountProject(id);
  }

  private _updatePhase(id: string, phase: UnregisteredProjectPhase): void {
    runInAction(() => {
      const store = this.projects.get(id);
      if (store && isUnregisteredProject(store)) store.phase = phase;
    });
  }

  private _markError(id: string, err: unknown): void {
    runInAction(() => {
      const store = this.projects.get(id);
      if (store && isUnregisteredProject(store)) {
        store.phase = 'error';
        store.error = err instanceof Error ? err.message : String(err);
      }
    });
  }
}
