import { makeObservable, observable, runInAction } from 'mobx';
import { LocalProject, SshProject } from '@shared/projects';
import type { ProjectViewSnapshot } from '@shared/view-state';
import { rpc } from '@renderer/lib/ipc';
import { queryClient } from '@renderer/lib/query-client';
import { appState } from '@renderer/lib/stores/app-state';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import {
  createUnmountedProject,
  createUnregisteredProject,
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
    const source: 'open' | 'create' | 'clone' | 'ssh' = isSsh
      ? 'ssh'
      : data.mode === 'pick'
        ? 'open'
        : data.mode === 'clone'
          ? 'clone'
          : 'create';

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
              })
            : await rpc.projects.createLocalProject({
                id: projectId,
                path: data.path,
                name: data.name,
              });
          this._setAndOpenProject(projectId, project);
          captureTelemetry('project_added', { source, success: true });
        } catch (err) {
          this._markError(projectId, err);
          captureTelemetry('project_added', { source, success: false });
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
          captureTelemetry('project_added', { source, success: true });
        } catch (err) {
          this._markError(projectId, err);
          captureTelemetry('project_added', { source, success: false });
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
          captureTelemetry('project_added', { source, success: true });
        } catch (err) {
          this._markError(projectId, err);
          captureTelemetry('project_added', { source, success: false });
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
    });

    const promise = Promise.all([
      rpc.projects.openProject(projectId),
      rpc.viewState.get(`project:${projectId}`),
    ])
      .then(async ([, savedSnapshot]) => {
        runInAction(() => {
          const current = this.projects.get(projectId);
          if (current && isUnmountedProject(current)) {
            current.transitionToMounted(
              current.data,
              savedSnapshot as ProjectViewSnapshot | undefined
            );
          }
        });
        queryClient.prefetchQuery({
          queryKey: ['repository', 'branches', projectId],
          queryFn: () => rpc.repository.getBranches(projectId),
        });
        queryClient.prefetchQuery({
          queryKey: ['repository', 'defaultBranch', projectId],
          queryFn: () => rpc.repository.getDefaultBranch(projectId),
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
