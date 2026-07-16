import { err, ok, type Result } from '@emdash/shared';
import { createLiveJobReplica, LiveJobCancelledError, LiveJobFailedError } from '@emdash/wire';
import { makeObservable, observable, runInAction } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import { getProjectsWireClient } from '@renderer/lib/runtime/projects-wire-client';
import { appState } from '@renderer/lib/stores/app-state';
import { viewStateCache } from '@renderer/lib/stores/view-state-cache';
import { log } from '@renderer/utils/logger';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import { projectsWireContract } from '@shared/core/projects/wire-contract';
import { sshConnectionEventChannel } from '@shared/core/ssh/sshEvents';
import type { WorkspaceBootstrapProgress } from '@shared/core/workspaces/wire-contract';
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
  ProjectCreationCompletion,
  ProjectCreationError,
  ProjectType,
  StartProjectCreationOptions,
  StartProjectCreationResult,
} from './project-creation-types';

export class ProjectManagerStore {
  projects = observable.map<string, ProjectStore>();
  pendingCreationIds = observable.set<string>();
  private _projectCreationJobs = new Map<string, { cancel(): Promise<void> }>();
  private _projectMountPromises = new Map<string, Promise<void>>();
  private _loadPromise: Promise<void> | null = null;
  private _lastSshRecoveryAttemptAt = 0;
  private _disposeSshConnectionEvent: (() => void) | null = null;
  private readonly _handleOnline = (): void => {
    this.retryDisconnectedSshProjects({ force: true });
  };
  private readonly _handleFocus = (): void => {
    this.retryDisconnectedSshProjects();
  };

  constructor() {
    makeObservable(this, { projects: observable, pendingCreationIds: observable });

    this._disposeSshConnectionEvent = events.on(sshConnectionEventChannel, (event) => {
      if (event.type !== 'connected' && event.type !== 'reconnected') return;
      this._mountDisconnectedSshProjects(event.connectionId);
    });

    globalThis.window?.addEventListener('online', this._handleOnline);
    globalThis.window?.addEventListener('focus', this._handleFocus);
  }

  dispose(): void {
    this._disposeSshConnectionEvent?.();
    this._disposeSshConnectionEvent = null;
    globalThis.window?.removeEventListener('online', this._handleOnline);
    globalThis.window?.removeEventListener('focus', this._handleFocus);
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

    const completion = await result.completion;
    return completion.success ? result.projectId : undefined;
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
  ): Promise<ProjectCreationCompletion> {
    const isSsh = projectType.type === 'ssh';
    const projectTelemetryType: 'local' | 'ssh' = isSsh ? 'ssh' : 'local';
    const projectTelemetryStrategy: 'open' | 'create' | 'clone' =
      data.mode === 'clone' ? 'clone' : data.mode === 'new' ? 'create' : 'open';

    let result: ProjectCreationCompletion;
    try {
      switch (data.mode) {
        case 'pick': {
          const projectResult =
            projectType.type === 'ssh'
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
          if (!projectResult.success) {
            result = err(projectResult.error);
            break;
          }

          const project = projectResult.data;
          if (data.initGitRepository) {
            await this._saveInitialGitHubAccountSetting(project.id, data.githubAccountId);
          }
          this._setAndOpenProject(projectId, project);
          result = ok();
          break;
        }

        case 'clone': {
          if (projectType.type === 'ssh') {
            result = err({
              type: 'clone-failed',
              message:
                'Remote projects require the workspace server and are not supported by this build',
            });
            break;
          }

          const projectResult = await this._createProjectFromRemote({
            projectId,
            mode: 'clone',
            repositoryUrl: data.repositoryUrl,
            targetPath,
            name: data.name,
          });
          if (!projectResult.success) {
            result = err(projectResult.error);
            break;
          }

          this._setAndOpenProject(projectId, projectResult.data);
          result = ok();
          break;
        }

        case 'new': {
          const repoResult = await rpc.github.createRepository({
            name: data.repositoryName,
            owner: data.repositoryOwner,
            isPrivate: data.repositoryVisibility === 'private',
            accountId: data.githubAccountId ?? undefined,
          });
          if (!repoResult.success) {
            result = err({
              type: 'repository-create-failed',
              message: repoResult.error?.trim() || 'Repository creation failed',
            });
            break;
          }
          if (!repoResult.nameWithOwner || !repoResult.cloneUrl) {
            result = err({
              type: 'repository-response-incomplete',
              message: 'Repository creation response was incomplete',
            });
            break;
          }

          const projectResult = await this._cloneInitializeAndCreateGitHubProject({
            projectType,
            projectId,
            targetPath,
            name: data.name,
            cloneUrl: repoResult.cloneUrl,
            repositoryNameWithOwner: repoResult.nameWithOwner,
            githubAccountId: data.githubAccountId,
          });
          if (!projectResult.success) {
            result = err(projectResult.error);
            break;
          }

          const project = projectResult.data;
          await this._saveInitialGitHubAccountSetting(project.id, data.githubAccountId);
          this._setAndOpenProject(projectId, project);
          result = ok();
          break;
        }
      }
    } catch (error) {
      this._markUnexpectedCreationError(projectId, error);
      captureTelemetry('project_added', {
        type: projectTelemetryType,
        strategy: projectTelemetryStrategy,
        success: false,
      });
      throw error;
    }

    if (!result.success) {
      if (result.error.type === 'cancelled') {
        this.removeUnregisteredProject(projectId);
      } else {
        this._markCreationError(projectId, result.error);
      }
    }
    captureTelemetry('project_added', {
      type: projectTelemetryType,
      strategy: projectTelemetryStrategy,
      success: result.success,
    });
    return result;
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
            // Patch repositoryWorkspaceId from the main process response so the
            // mounted project data is up-to-date (fixes stale null after creation).
            const projectData = current.data;
            if (openResult.data.repositoryWorkspaceId && projectData) {
              projectData.repositoryWorkspaceId = openResult.data.repositoryWorkspaceId;
            }
            current.transitionToMounted(
              projectData,
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
      const result = await (await getProjectsWireClient()).delete({ projectId });
      if (!result.success) throw new Error(result.error.message);
    } catch (err) {
      runInAction(() => {
        if (snapshot) this.projects.set(projectId, snapshot);
      });
      throw err;
    }
  }

  retryDisconnectedSshProjects(options: { force?: boolean } = {}): void {
    const now = Date.now();
    if (!options.force && now - this._lastSshRecoveryAttemptAt < 5_000) return;

    const connectionIds = new Set<string>();
    for (const store of this.projects.values()) {
      if (
        isUnmountedProject(store) &&
        store.errorCode === 'ssh-disconnected' &&
        store.data.type === 'ssh'
      ) {
        connectionIds.add(store.data.connectionId);
      }
    }

    if (connectionIds.size === 0) return;
    this._lastSshRecoveryAttemptAt = now;

    for (const connectionId of connectionIds) {
      const state = appState.sshConnections.stateFor(connectionId);
      if (state === 'connected') {
        this._mountDisconnectedSshProjects(connectionId);
        continue;
      }
      if (state === 'connecting') continue;
      void appState.sshConnections
        .connect(connectionId, { force: true })
        .then(() => {
          if (appState.sshConnections.stateFor(connectionId) === 'connected') {
            this._mountDisconnectedSshProjects(connectionId);
          }
        })
        .catch(() => {});
    }
  }

  private _mountDisconnectedSshProjects(connectionId: string): void {
    for (const [projectId, store] of this.projects) {
      if (
        isUnmountedProject(store) &&
        store.errorCode === 'ssh-disconnected' &&
        store.data.type === 'ssh' &&
        store.data.connectionId === connectionId
      ) {
        this.mountProject(projectId).catch(() => {});
      }
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

  cancelProjectCreation(projectId: string): void {
    void this._projectCreationJobs.get(projectId)?.cancel();
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

  private async _createProjectFromRemote(opts: {
    projectId: string;
    mode: 'clone' | 'new';
    repositoryUrl: string;
    targetPath: string;
    name: string;
  }): Promise<Result<LocalProject, ProjectCreationError>> {
    const client = await getProjectsWireClient();
    const jobs = createLiveJobReplica(projectsWireContract.create, client.create);
    const lease = await jobs.start({
      projectId: opts.projectId,
      mode: opts.mode,
      repositoryUrl: opts.repositoryUrl,
      targetPath: opts.targetPath,
      name: opts.name,
    });
    const job = await lease.ready();
    this._projectCreationJobs.set(opts.projectId, job);
    const unsubscribe = job.onProgress((progress) => {
      this._updatePhase(
        opts.projectId,
        progress.step === 'initialising-workspace' ? 'registering' : 'cloning',
        progress
      );
    });

    try {
      return ok(await job.result);
    } catch (error) {
      return err(projectWireErrorToCreationError(error));
    } finally {
      unsubscribe();
      if (this._projectCreationJobs.get(opts.projectId) === job) {
        this._projectCreationJobs.delete(opts.projectId);
      }
      await lease.release();
      await jobs.dispose();
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
  }): Promise<Result<LocalProject | SshProject, ProjectCreationError>> {
    if (opts.projectType.type === 'ssh') {
      await this._rollbackCreatedGitHubRepository(
        opts.repositoryNameWithOwner,
        opts.githubAccountId
      );
      return err({
        type: 'clone-failed',
        message: 'Remote projects require the workspace server and are not supported by this build',
      });
    }

    let result: Result<LocalProject, ProjectCreationError>;
    try {
      result = await this._createProjectFromRemote({
        projectId: opts.projectId,
        mode: 'new',
        repositoryUrl: opts.cloneUrl,
        targetPath: opts.targetPath,
        name: opts.name,
      });
    } catch (error) {
      await this._rollbackCreatedGitHubRepository(
        opts.repositoryNameWithOwner,
        opts.githubAccountId
      );
      throw error;
    }

    if (!result.success) {
      await this._rollbackCreatedGitHubRepository(
        opts.repositoryNameWithOwner,
        opts.githubAccountId
      );
    }
    return result;
  }

  private _updatePhase(
    id: string,
    phase: UnregisteredProjectPhase,
    progress?: WorkspaceBootstrapProgress
  ): void {
    runInAction(() => {
      const store = this.projects.get(id);
      if (store && isUnregisteredProject(store)) {
        store.phase = phase;
        store.progressMessage = progress?.message;
        store.operation = progress?.operation;
      }
    });
  }

  private _markCreationError(id: string, error: ProjectCreationError): void {
    runInAction(() => {
      const store = this.projects.get(id);
      if (store && isUnregisteredProject(store)) {
        store.phase = 'error';
        store.error =
          error.type === 'not-repository'
            ? 'Directory is not a git repository. Enable "Initialize git repository" to continue.'
            : error.type === 'inspect-failed'
              ? `Could not inspect directory: ${error.message}`
              : error.message;
      }
    });
  }

  private _markUnexpectedCreationError(id: string, error: unknown): void {
    runInAction(() => {
      const store = this.projects.get(id);
      if (store && isUnregisteredProject(store)) {
        store.phase = 'error';
        store.error = error instanceof Error ? error.message : String(error);
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

function projectWireErrorToCreationError(error: unknown): ProjectCreationError {
  if (error instanceof LiveJobCancelledError) {
    return { type: 'cancelled', message: 'Project creation was cancelled' };
  }

  const payload = error instanceof LiveJobFailedError ? error.error : error;
  if (typeof payload === 'object' && payload !== null) {
    const type = (payload as { type?: unknown }).type;
    const message = (payload as { message?: unknown }).message;
    const fallback = typeof message === 'string' ? message : 'Project creation failed';
    if (type === 'cancelled') return { type: 'cancelled', message: fallback };
    if (type === 'initialize-failed') return { type: 'initialize-failed', message: fallback };
    if (type === 'not-repository') return { type: 'not-repository', path: '' };
    if (type === 'inspect-failed') {
      return {
        type: 'inspect-failed',
        path: '',
        message: fallback,
      };
    }
    if (type === 'invalid-directory') {
      return {
        type: 'invalid-directory',
        path: '',
        message: fallback,
      };
    }
    return { type: 'clone-failed', message: fallback };
  }
  return {
    type: 'clone-failed',
    message: error instanceof Error ? error.message : String(error),
  };
}
