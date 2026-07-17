import { err, ok, type Result } from '@emdash/shared';
import {
  LifecycleRegistry,
  type Disposable,
  type LifecycleRegistryState,
  type LifecycleRegistryStateChange,
} from '@emdash/shared/concurrency';
import { runWithTimeout, TimeoutError } from '@emdash/shared/scheduling';
import type { LocalProject, SshProject } from '@core/primitives/projects/api';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import { createProvider } from './create-project-provider';
import type { ProjectProvider } from './project-provider';

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

type ProjectLifecycleState = LifecycleRegistryState<
  ProjectProvider,
  ProviderLifecycleError,
  ProviderLifecycleError
>;

type ProjectLifecycleStateChange = LifecycleRegistryStateChange<
  ProjectProvider,
  ProviderLifecycleError,
  ProviderLifecycleError
>;

function toInitError(e: unknown): ProviderLifecycleError {
  if (e instanceof TimeoutError)
    return { type: 'timeout', message: e.message, timeout: e.durationMs };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

function toTeardownError(e: unknown): ProviderLifecycleError {
  if (e instanceof TimeoutError)
    return { type: 'timeout', message: e.message, timeout: e.durationMs };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

class ProjectSessionManager implements Hookable<ProjectSessionManagerHooks>, Disposable {
  private readonly _hooks = new HookCore<ProjectSessionManagerHooks>((name, e) =>
    log.error(`ProjectManager: ${String(name)} hook error`, e)
  );
  private readonly _lifecycle = new LifecycleRegistry<
    LocalProject | SshProject,
    ProjectProvider,
    ProviderLifecycleError,
    void,
    ProviderLifecycleError
  >({
    label: 'project-session-manager',
    keyOf: (project) => project.id,
    start: async (project) => this.startProject(project),
    stop: async (projectId, provider) => this.stopProject(projectId, provider),
    onStateChanged: (change) => this.handleLifecycleStateChanged(change),
    onObserverError: ({ error }) => log.error('ProjectManager: lifecycle observer error', error),
  });

  on<K extends keyof ProjectSessionManagerHooks>(name: K, handler: ProjectSessionManagerHooks[K]) {
    return this._hooks.on(name, handler);
  }

  async openProject(
    project: LocalProject | SshProject
  ): Promise<Result<ProjectProvider, ProviderLifecycleError>> {
    return this._lifecycle.start(project);
  }

  async closeProject(projectId: string): Promise<Result<void, ProviderLifecycleError>> {
    return this._lifecycle.stop(projectId);
  }

  getProject(projectId: string): ProjectProvider | undefined {
    return this._lifecycle.get(projectId);
  }

  async dispose(): Promise<void> {
    const ids = Array.from(this._lifecycle.keys());
    await Promise.allSettled(ids.map((id) => this.closeProject(id)));
    for (const [id, state] of this._lifecycle.states()) {
      if (state.kind === 'stop-failed') {
        log.error('ProjectManager: project teardown error recorded after dispose', {
          projectId: id,
          message: state.error.message,
        });
      }
    }
    await this._lifecycle.dispose();
  }

  async release(): Promise<void> {
    const providers = Array.from(this._lifecycle.values());
    const results = await Promise.allSettled(providers.map((provider) => provider.release()));
    const failures = results.filter((result) => result.status === 'rejected');
    for (const failure of failures) {
      log.error('ProjectManager: failed to release', failure.reason);
    }
    if (failures.length > 0) throw failures[0].reason;
  }

  private async startProject(
    project: LocalProject | SshProject
  ): Promise<Result<ProjectProvider, ProviderLifecycleError>> {
    try {
      const provider = await runWithTimeout(() => createProvider(project), {
        timeoutMs: project.type === 'ssh' ? SSH_PROVIDER_TIMEOUT_MS : LOCAL_PROVIDER_TIMEOUT_MS,
      });
      if (!provider.success) return err({ type: 'error', message: provider.error.message });
      return ok(provider.data);
    } catch (e) {
      const initError = toInitError(e);
      log.error('ProjectManager: error during project initialization', {
        projectId: project.id,
        ...initError,
      });
      return err(initError);
    }
  }

  private async stopProject(
    projectId: string,
    provider: ProjectProvider
  ): Promise<Result<void, ProviderLifecycleError>> {
    try {
      await runWithTimeout(() => provider.dispose(), {
        timeoutMs: TEARDOWN_PROVIDER_TIMEOUT_MS,
      });
      return ok();
    } catch (e) {
      const error = toTeardownError(e);
      log.error('ProjectManager: error during project teardown', { projectId, ...error });
      return err(error);
    }
  }

  private handleLifecycleStateChanged(change: ProjectLifecycleStateChange): void {
    if (change.current.kind === 'ready' && change.previous.kind !== 'ready') {
      this._hooks.callHookBackground('projectOpened', change.key, change.current.value);
    }

    if (ownsProvider(change.previous) && isRemovedState(change.current)) {
      this._hooks.callHookBackground('projectClosed', change.key);
    }
  }
}

export const projectManager = new ProjectSessionManager();

function ownsProvider(state: ProjectLifecycleState): boolean {
  return state.kind === 'ready' || state.kind === 'stopping' || state.kind === 'stop-failed';
}

function isRemovedState(state: ProjectLifecycleState): boolean {
  return state.kind === 'idle' || state.kind === 'disposed';
}
