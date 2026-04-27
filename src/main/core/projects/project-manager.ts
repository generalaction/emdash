import type {
  LocalProject,
  OpenProjectError,
  ProjectBootstrapStatus,
  SshProject,
} from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import { log } from '@main/lib/logger';
import { LocalFileSystem } from '../fs/impl/local-fs';
import { SshFileSystem } from '../fs/impl/ssh-fs';
import { getProjectById, getProjects } from '../projects/operations/getProjects';
import { sshConnectionManager } from '../ssh/ssh-connection-manager';
import { createLocalProvider } from './impl/local-project-provider';
import { createSshProvider } from './impl/ssh-project-provider';
import { checkIsValidDirectory } from './path-utils';
import type { ProjectProvider } from './project-provider';
import { TimeoutSignal, withTimeout } from './utils';

const PROVIDER_TIMEOUT_MS = 60_000;

type ProjectLifecycleHook = (projectId: string) => void | Promise<void>;

type ProviderError = {
  type: 'error';
  message: string;
};

type TimeoutError = {
  type: 'timeout';
  message: string;
  timeout: number;
};

type InitializeProviderError = TimeoutError | ProviderError;
type TeardownProviderError = TimeoutError | ProviderError;

function toInitError(e: unknown): InitializeProviderError {
  if (e instanceof TimeoutSignal) return { type: 'timeout', message: e.message, timeout: e.ms };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

function toTeardownError(e: unknown): TeardownProviderError {
  if (e instanceof TimeoutSignal) return { type: 'timeout', message: e.message, timeout: e.ms };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

class ProjectManager {
  private initializingProviders = new Map<
    string,
    Promise<Result<ProjectProvider, InitializeProviderError>>
  >();
  private providers = new Map<string, ProjectProvider>();
  private tearingDownProviders = new Map<string, Promise<Result<void, TeardownProviderError>>>();
  private initializationErrors = new Map<string, InitializeProviderError>();
  private _onProjectOpenedHooks: ProjectLifecycleHook[] = [];
  private _onProjectClosedHooks: ProjectLifecycleHook[] = [];

  async initialize(): Promise<void> {
    const allProjects = await getProjects();

    await Promise.allSettled(
      allProjects.map(async (project) => {
        await this.openProject(project);
      })
    );
  }

  async openProject(
    project: LocalProject | SshProject
  ): Promise<Result<ProjectProvider, InitializeProviderError>> {
    if (this.providers.has(project.id)) return ok(this.providers.get(project.id)!);
    if (this.initializingProviders.has(project.id))
      return this.initializingProviders.get(project.id)!;

    const promise = withTimeout(createProvider(project), PROVIDER_TIMEOUT_MS)
      .then((provider) => {
        this.providers.set(project.id, provider);
        this.initializingProviders.delete(project.id);
        this._fireHooks(this._onProjectOpenedHooks, project.id, 'onProjectOpened');
        return ok(provider);
      })
      .catch((e) => {
        const initError = toInitError(e);
        this.initializationErrors.set(project.id, initError);
        this.initializingProviders.delete(project.id);
        log.error('ProjectManager: error during project initialization', {
          projectId: project.id,
          ...initError,
        });
        return err<InitializeProviderError>(initError);
      });

    this.initializingProviders.set(project.id, promise);
    return promise;
  }

  async closeProject(projectId: string): Promise<Result<void, TeardownProviderError>> {
    if (this.tearingDownProviders.has(projectId)) return this.tearingDownProviders.get(projectId)!;
    const provider = this.providers.get(projectId);
    if (!provider) return ok();

    const promise = withTimeout(provider.cleanup(), PROVIDER_TIMEOUT_MS)
      .then(() => ok<void>())
      .catch((e) => {
        const error = toTeardownError(e);
        log.error('ProjectManager: error during project teardown', { projectId, ...error });
        return err<TeardownProviderError>(error);
      })
      .finally(() => {
        this.providers.delete(projectId);
        this.tearingDownProviders.delete(projectId);
        this._fireHooks(this._onProjectClosedHooks, projectId, 'onProjectClosed');
      });

    this.tearingDownProviders.set(projectId, promise);
    return promise;
  }

  registerOnProjectOpened(hook: ProjectLifecycleHook): void {
    this._onProjectOpenedHooks.push(hook);
  }

  registerOnProjectClosed(hook: ProjectLifecycleHook): void {
    this._onProjectClosedHooks.push(hook);
  }

  private _fireHooks(hooks: ProjectLifecycleHook[], projectId: string, name: string): void {
    for (const hook of hooks) {
      Promise.resolve(hook(projectId)).catch((e) =>
        log.error(`ProjectManager: ${name} hook error`, { projectId, error: String(e) })
      );
    }
  }

  getProject(projectId: string): ProjectProvider | undefined {
    return this.providers.get(projectId);
  }

  getProjectBootstrapStatus(projectId: string): ProjectBootstrapStatus {
    if (this.providers.has(projectId)) return { status: 'ready' };
    if (this.initializingProviders.has(projectId)) return { status: 'bootstrapping' };
    const initError = this.initializationErrors.get(projectId);
    if (initError) return { status: 'error', message: initError.message };
    return { status: 'not-started' };
  }

  async openProjectById(projectId: string): Promise<Result<void, OpenProjectError>> {
    const project = await getProjectById(projectId);
    if (!project) return err({ type: 'error', message: `Project not found: ${projectId}` });
    if (project.type === 'local' && !checkIsValidDirectory(project.path)) {
      return err({ type: 'path-not-found', path: project.path });
    }
    const result = await this.openProject(project);
    if (!result.success) {
      if (project.type === 'ssh') {
        return err({ type: 'ssh-disconnected', connectionId: project.connectionId });
      }
      return err({ type: 'error', message: result.error.message });
    }
    return ok();
  }

  async shutdown(): Promise<void> {
    const ids = Array.from(this.providers.keys());
    await Promise.allSettled(ids.map((id) => this.closeProject(id)));
  }
}

async function createProvider(project: LocalProject | SshProject): Promise<ProjectProvider> {
  if (project.type === 'ssh') {
    const proxy = await sshConnectionManager.connect(project.connectionId);
    const rootFs = new SshFileSystem(proxy, '/');
    return createSshProvider(project, rootFs, proxy);
  }
  const rootFs = new LocalFileSystem('/');
  return createLocalProvider(project, rootFs);
}

export const projectManager = new ProjectManager();
