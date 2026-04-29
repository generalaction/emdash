import type { LocalProject, ProjectBootstrapStatus, SshProject } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { LifecycleMap } from '@main/lib/lifecycle-map';
import { log } from '@main/lib/logger';
import { SshFileSystem } from '../fs/impl/ssh-fs';
import { sshConnectionManager } from '../ssh/ssh-connection-manager';
import { createLocalProvider } from './impl/local-project-provider';
import { createSshProvider } from './impl/ssh-project-provider';
import type { ProjectProvider } from './project-provider';
import { TimeoutSignal, withTimeout } from './utils';

const SSH_PROVIDER_TIMEOUT_MS = 60_000;
const LOCAL_PROVIDER_TIMEOUT_MS = 20_000;
const TEARDOWN_PROVIDER_TIMEOUT_MS = 60_000;

export type ProjectManagerHooks = {
  projectOpened: (projectId: string) => void | Promise<void>;
  projectClosed: (projectId: string) => void | Promise<void>;
};

type ProviderLifecycleError =
  | { type: 'timeout'; message: string; timeout: number }
  | { type: 'error'; message: string };

function toInitError(e: unknown): ProviderLifecycleError {
  if (e instanceof TimeoutSignal) return { type: 'timeout', message: e.message, timeout: e.ms };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

function toTeardownError(e: unknown): ProviderLifecycleError {
  if (e instanceof TimeoutSignal) return { type: 'timeout', message: e.message, timeout: e.ms };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

class ProjectManager implements Hookable<ProjectManagerHooks> {
  private readonly _lifecycle = new LifecycleMap<ProjectProvider, ProviderLifecycleError>();
  private readonly _hooks = new HookCore<ProjectManagerHooks>((name, e) =>
    log.error(`ProjectManager: ${String(name)} hook error`, e)
  );

  on<K extends keyof ProjectManagerHooks>(name: K, handler: ProjectManagerHooks[K]) {
    return this._hooks.on(name, handler);
  }

  async openProject(
    project: LocalProject | SshProject
  ): Promise<Result<ProjectProvider, ProviderLifecycleError>> {
    return this._lifecycle.provision(project.id, async () => {
      try {
        const provider = await withTimeout(
          createProvider(project),
          project.type === 'ssh' ? SSH_PROVIDER_TIMEOUT_MS : LOCAL_PROVIDER_TIMEOUT_MS
        );
        this._hooks.callHookBackground('projectOpened', project.id);
        return ok(provider);
      } catch (e) {
        const initError = toInitError(e);
        log.error('ProjectManager: error during project initialization', {
          projectId: project.id,
          ...initError,
        });
        return err(initError);
      }
    });
  }

  async closeProject(projectId: string): Promise<Result<void, ProviderLifecycleError>> {
    return (
      this._lifecycle.teardown(
        projectId,
        async (provider) => {
          try {
            await withTimeout(provider.cleanup(), TEARDOWN_PROVIDER_TIMEOUT_MS);
            return ok();
          } catch (e) {
            const error = toTeardownError(e);
            log.error('ProjectManager: error during project teardown', { projectId, ...error });
            return err(error);
          }
        },
        () => this._hooks.callHookBackground('projectClosed', projectId)
      ) ?? ok()
    );
  }

  getProject(projectId: string): ProjectProvider | undefined {
    return this._lifecycle.get(projectId);
  }

  getProjectBootstrapStatus(projectId: string): ProjectBootstrapStatus {
    return this._lifecycle.bootstrapStatus(projectId, (e) => e.message);
  }

  async shutdown(): Promise<void> {
    const ids = Array.from(this._lifecycle.keys());
    await Promise.allSettled(ids.map((id) => this.closeProject(id)));
  }
}

async function createProvider(project: LocalProject | SshProject) {
  if (project.type === 'ssh') {
    const proxy = await sshConnectionManager.connect(project.connectionId);
    const rootFs = new SshFileSystem(proxy, '/');
    return createSshProvider(project, rootFs, proxy);
  }
  return createLocalProvider(project);
}

export const projectManager = new ProjectManager();
