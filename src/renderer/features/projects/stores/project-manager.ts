import { makeObservable, observable, runInAction } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';
import { log } from '@renderer/utils/logger';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import { sshConnectionEventChannel } from '@shared/core/ssh/sshEvents';
import { type LocalProject, type SshProject } from '@shared/projects';
import { splitNameWithOwner } from '@shared/repository-ref';
import type { ProjectViewSnapshot } from '@shared/view-state';
import {
  createUnmountedProject,
  createUnregisteredProject,
  isMountedProject,
  isUnmountedProject,
  isUnregisteredProject,
  type ProjectStore,
  type UnregisteredProjectPhase,
} from './project';
import type {
  ModeData,
  ProjectType,
  StartProjectCreationOptions,
  StartProjectCreationResult,
} from './project-creation-types';

export class ProjectManagerStore {
  projects = observable.map<string, ProjectStore>();
  pendingCreationIds = observable.set<string>();
  private _projectMountPromises = new Map<string, Promise<void>>();
  private _loadPromise: Promise<void> | null = null;

  constructor() {
    makeObservable(this, { projects: observable, pendingCreationIds: observable });

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
    const result = await this.startProjectCreation(projectType, data, { id });
    if (result.kind === 'existing') return result.projectId;

    await result.completion;
    return result.projectId;
  }

  async startProjectCreation(
    projectType: ProjectType,
    data: ModeData,
    options: StartProjectCreationOptions = {}
  ): Promise<StartProjectCreationResult> {
    const isSsh = projectType.type === 'ssh';
    const projectId = options.id ?? crypto.randomUUID();
    const targetPath = data.mode === 'pick' ? data.path : `${data.path}/${data.name}`;
    const inspection = await rpc.projects.inspectProjectPath(
      isSsh
        ? { type: 'ssh', path: targetPath, connectionId: projectType.connectionId }
        : { type: 'local', path: targetPath }
    );
    if (inspection.existingProject) {
      return { kind: 'existing', projectId: inspection.existingProject.id };
    }

    runInAction(() => {
      this.pendingCreationIds.add(projectId);
      this.projects.set(
        projectId,
        createUnregisteredProject(projectId, data.name, initialCreationPhase(data.mode), data.mode)
      );
    });

    const completion = this._doCreateProject(projectType, data, projectId, targetPath).finally(
      () => {
        runInAction(() => this.pendingCreationIds.delete(projectId));
      }
    );

    return { kind: 'creating', projectId, completion };
  }

  private async _doCreateProject(
    projectType: ProjectType,
    data: ModeData,
    projectId: string,
    targetPath: string
  ): Promise<void> {
    const isSsh = projectType.type === 'ssh';
    const projectTelemetryType: 'local' | 'ssh' = isSsh ? 'ssh' : 'local';
    const projectTelemetryStrategy: 'open' | 'create' | 'clone' =
      data.mode === 'clone' ? 'clone' : data.mode === 'new' ? 'create' : 'open';

    switch (data.mode) {
      case 'pick': {
        try {
          const project = isSsh
            ? await rpc.projects.createProject({
                type: 'ssh',
                id: projectId,
                path: targetPath,
                name: data.name,
                connectionId: projectType.connectionId,
                initGitRepository: data.initGitRepository,
              })
            : await rpc.projects.createProject({
                type: 'local',
                id: projectId,
                path: targetPath,
                name: data.name,
                initGitRepository: data.initGitRepository,
              });
          if (data.initGitRepository) {
            await this._saveInitialGitHubAccountSetting(project.id, data.githubAccountId);
          }
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
        try {
          const connectionId = isSsh ? projectType.connectionId : undefined;
          const cloneResult = await rpc.github.cloneRepository(
            data.repositoryUrl,
            targetPath,
            connectionId
          );
          if (!cloneResult.success) throw new Error(cloneResult.error);
          this._updatePhase(projectId, 'registering');
          const project = isSsh
            ? await rpc.projects.createProject({
                type: 'ssh',
                id: projectId,
                path: targetPath,
                name: data.name,
                connectionId: projectType.connectionId,
              })
            : await rpc.projects.createProject({
                type: 'local',
                id: projectId,
                path: targetPath,
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
        try {
          const repoResult = await rpc.github.createRepository({
            name: data.repositoryName,
            owner: data.repositoryOwner,
            isPrivate: data.repositoryVisibility === 'private',
            accountId: data.githubAccountId ?? undefined,
          });
          if (!repoResult.success) {
            throw new Error(repoResult.error);
          }
          if (!repoResult.nameWithOwner || !repoResult.cloneUrl) {
            throw new Error('Repository creation response was incomplete');
          }

          const project = await this._cloneInitializeAndCreateGitHubProject({
            projectType,
            projectId,
            targetPath,
            name: data.name,
            cloneUrl: repoResult.cloneUrl,
            repositoryNameWithOwner: repoResult.nameWithOwner,
            githubAccountId: data.githubAccountId,
          });
          await this._saveInitialGitHubAccountSetting(project.id, data.githubAccountId);
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
      viewStateCache.get(`project:${projectId}`),
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
    appState.navigation.revalidate();
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
    void this.mountProject(id);
  }

  private async _saveInitialGitHubAccountSetting(
    projectId: string,
    githubAccountId?: string
  ): Promise<void> {
    if (githubAccountId === undefined) return;

    const result = await rpc.projects.patchProjectSettings(projectId, { githubAccountId });
    if (!result.success) {
      log.error('Failed to save initial GitHub account for project', {
        projectId,
        error: result.error,
      });
    }
  }

  private async _rollbackCreatedGitHubRepository(
    nameWithOwner: string,
    githubAccountId?: string
  ): Promise<void> {
    try {
      const { owner, repo } = splitNameWithOwner(nameWithOwner);
      const result = await rpc.github.deleteRepository({
        owner,
        name: repo,
        accountId: githubAccountId ?? undefined,
      });
      if (!result.success) {
        log.error('Failed to delete GitHub repository after project creation failure', {
          nameWithOwner,
          error: result.error,
        });
      }
    } catch (error) {
      log.error('Failed to delete GitHub repository after project creation failure', {
        nameWithOwner,
        error,
      });
    }
  }

  private async _cloneInitializeAndCreateGitHubProject(opts: {
    projectType: ProjectType;
    projectId: string;
    targetPath: string;
    name: string;
    cloneUrl: string;
    repositoryNameWithOwner: string;
    githubAccountId?: string;
  }): Promise<LocalProject | SshProject> {
    const connectionId =
      opts.projectType.type === 'ssh' ? opts.projectType.connectionId : undefined;

    try {
      this._updatePhase(opts.projectId, 'cloning');
      const cloneResult = await rpc.github.cloneRepository(
        opts.cloneUrl,
        opts.targetPath,
        connectionId
      );
      if (!cloneResult.success) throw new Error(cloneResult.error);

      const initResult = await rpc.github.initializeProject({
        targetPath: opts.targetPath,
        name: opts.name,
        connectionId,
      });
      if (!initResult.success) throw new Error(initResult.error);

      this._updatePhase(opts.projectId, 'registering');
      return opts.projectType.type === 'ssh'
        ? await rpc.projects.createProject({
            type: 'ssh',
            id: opts.projectId,
            path: opts.targetPath,
            name: opts.name,
            connectionId: opts.projectType.connectionId,
          })
        : await rpc.projects.createProject({
            type: 'local',
            id: opts.projectId,
            path: opts.targetPath,
            name: opts.name,
          });
    } catch (err) {
      await this._rollbackCreatedGitHubRepository(
        opts.repositoryNameWithOwner,
        opts.githubAccountId
      );
      throw err;
    }
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

function initialCreationPhase(mode: ModeData['mode']): UnregisteredProjectPhase {
  switch (mode) {
    case 'pick':
      return 'registering';
    case 'clone':
      return 'cloning';
    case 'new':
      return 'creating-repo';
  }
}
