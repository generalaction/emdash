import type { LocalProject, SshProject } from '@shared/projects';
import { log } from '@main/lib/logger';
import { err, ok, type Result } from '@main/lib/result';
import { getProjects } from '../projects/operations/getProjects';
import { createLocalProvider } from './impl/local-project-provider';
import type { ProjectProvider } from './project-provider';
import { TimeoutSignal, withTimeout } from './utils';

const PROVIDER_TIMEOUT_MS = 60_000;

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

  async initialize(): Promise<void> {
    const allProjects = await getProjects();

    await Promise.allSettled(
      allProjects.map(async (project) => {
        const result = await this.openProject(project);
        if (!result.success) {
          log.error('ProjectManager: failed to initialize provider', {
            projectId: project.id,
            ...result.error,
          });
        }
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
        return ok(provider);
      })
      .catch((e) => {
        this.initializingProviders.delete(project.id);
        log.error('ProjectManager: error during project initialization', {
          projectId: project.id,
          ...toInitError(e),
        });
        return err<InitializeProviderError>(toInitError(e));
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
      });

    this.tearingDownProviders.set(projectId, promise);
    return promise;
  }

  getProject(projectId: string): ProjectProvider | undefined {
    return this.providers.get(projectId);
  }

  async shutdown(): Promise<void> {
    const ids = Array.from(this.providers.keys());
    await Promise.allSettled(ids.map((id) => this.closeProject(id)));
  }
}

async function createProvider(project: LocalProject | SshProject): Promise<ProjectProvider> {
  if (project.type === 'ssh') {
    throw new Error('SSH projects are not yet supported');
  }
  return createLocalProvider(project);
}

export const projectManager = new ProjectManager();
