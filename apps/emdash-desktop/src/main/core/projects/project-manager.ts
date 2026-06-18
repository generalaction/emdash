import { err, ok, type Result } from '@emdash/shared';
import { HookCore, type Hookable } from '@main/lib/hookable';
import type { IDisposable } from '@main/lib/lifecycle';
import { LifecycleMap } from '@main/lib/lifecycle-map';
import { log } from '@main/lib/logger';
import type { LocalProject, SshProject } from '@shared/projects';
import { createProvider } from './create-project-provider';
import type { ProjectProvider } from './project-provider';
import { TimeoutSignal, withTimeout } from './utils';

const SSH_PROVIDER_TIMEOUT_MS = 60_000;
const LOCAL_PROVIDER_TIMEOUT_MS = 20_000;
const TEARDOWN_PROVIDER_TIMEOUT_MS = 60_000;

type ProjectSessionManagerHooks = {
  projectOpened: (projectId: string, provider: ProjectProvider) => void | Promise<void>;
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

class ProjectSessionManager implements Hookable<ProjectSessionManagerHooks>, IDisposable {
  private readonly _hooks = new HookCore<ProjectSessionManagerHooks>((name, e) =>
    log.error(`ProjectManager: ${String(name)} hook error`, e)
  );
  private readonly _lifecycle = new LifecycleMap<
    ProjectProvider,
    ProviderLifecycleError,
    ProviderLifecycleError
  >({
    postProvision: (id, provider) => this._hooks.callHookBackground('projectOpened', id, provider),
    postTeardown: (id) => this._hooks.callHookBackground('projectClosed', id),
  });

  on<K extends keyof ProjectSessionManagerHooks>(name: K, handler: ProjectSessionManagerHooks[K]) {
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
      this._lifecycle.teardown(projectId, async (provider) => {
        try {
          await withTimeout(provider.dispose(), TEARDOWN_PROVIDER_TIMEOUT_MS);
          return ok();
        } catch (e) {
          const error = toTeardownError(e);
          log.error('ProjectManager: error during project teardown', { projectId, ...error });
          return err(error);
        }
      }) ?? ok()
    );
  }

  getProject(projectId: string): ProjectProvider | undefined {
    return this._lifecycle.get(projectId);
  }

  async dispose(): Promise<void> {
    const ids = Array.from(this._lifecycle.keys());
    await Promise.allSettled(ids.map((id) => this.closeProject(id)));
    for (const id of ids) {
      const status = this._lifecycle.teardownStatus(id);
      if (status.status === 'error') {
        log.error('ProjectManager: project teardown error recorded after dispose', {
          projectId: id,
          message: status.error.message,
        });
      }
    }
  }
}

export const projectManager = new ProjectSessionManager();
