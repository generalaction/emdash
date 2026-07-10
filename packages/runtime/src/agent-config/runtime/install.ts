import {
  buildDescriptorFromProvider,
  HostDependencyManager,
  type DependencyInstallError,
  type DependencyState,
  type DependencyUninstallError,
} from '@emdash/core/deps/runtime';
import type { SpawnContextResolver } from '@emdash/core/agents/spawn-context';
import type {
  AgentConfigEntry,
  AgentConfigList,
  AgentConfigRefreshError,
  AgentInstallError,
  AgentInstallProgress,
  AgentUninstallError,
} from '@emdash/core/workspace-server';
import { err, ok, type Result } from '@emdash/shared';
import type { LiveJobContext } from '@emdash/wire';
import type { AgentConfigAgentsModel } from '../state/live-models';
import { publishLiveModelState } from '../state/live-models';
import type { AgentConfigRuntimeDeps } from './types';

type InstallStrategy = { kind: 'package-manager'; method?: string } | { kind: 'custom'; command: string };
type UninstallStrategy =
  | { kind: 'package-manager'; method?: string }
  | { kind: 'custom'; command: string };

export class AgentInstallManager {
  private readonly manager: HostDependencyManager;
  private readonly providersById: Map<string, ReturnType<AgentConfigRuntimeDeps['pluginHost']['getAll']>[number]>;
  private readonly descriptors: ReturnType<typeof buildDescriptorFromProvider>[];
  private readonly currentProgress = new Map<string, (chunk: string) => void>();
  private list: AgentConfigList = {};

  constructor(
    private readonly deps: AgentConfigRuntimeDeps,
    private readonly agentsModel: AgentConfigAgentsModel,
    private readonly spawnContext?: SpawnContextResolver
  ) {
    const providers = deps.pluginHost.getAll();
    this.providersById = new Map(
      providers.map((provider) => [provider.metadata.id, provider])
    );
    this.descriptors = providers.map(buildDescriptorFromProvider);
    this.manager = new HostDependencyManager(deps.exec, {
      runInstallCommand: (command) =>
        deps.installCommandRunner(command, {
          onOutput: (chunk) => {
            for (const progress of this.currentProgress.values()) progress(chunk);
          },
        }),
      platform: deps.platform,
      dependencies: this.descriptors,
      getDependencyDescriptor: (id) => this.descriptors.find((descriptor) => descriptor.id === id),
      logger: deps.logger,
    });
    this.manager.onStatusUpdated.subscribe((event) => {
      this.spawnContext?.invalidate(event.id);
      this.updateInstall(event.id, event.state);
    });
    this.seedProviders();
  }

  initialize(): void {
    this.manager.initialize();
  }

  async refresh(input: {
    providerId?: string;
    refreshShellEnv?: boolean;
  }): Promise<Result<void, AgentConfigRefreshError>> {
    if (input.providerId) {
      if (!this.providersById.has(input.providerId)) {
        return err({ type: 'unknown-provider' as const, providerId: input.providerId });
      }
      await this.manager.probe(input.providerId);
      return ok();
    }
    await this.manager.probeCategory('agent', { refreshShellEnv: input.refreshShellEnv });
    return ok();
  }

  async install(
    providerId: string,
    strategy: InstallStrategy,
    ctx: LiveJobContext<AgentInstallProgress>
  ): Promise<Result<DependencyState, AgentInstallError>> {
    if (!this.providersById.has(providerId)) {
      return err({ type: 'unknown-provider', providerId });
    }

    this.currentProgress.set(ctx.jobId, (output) => ctx.progress({ providerId, output }));
    try {
      if (strategy.kind === 'custom') {
        const run = await this.deps.installCommandRunner(strategy.command, {
          signal: ctx.signal,
          onOutput: (output) => ctx.progress({ providerId, output }),
        });
        if (!run.success) return err(run.error);
        const state = await this.manager.probe(providerId);
        if (state.status !== 'available') {
          return err({ type: 'not-detected-after-install', providerId });
        }
        return ok(state);
      }

      const result = await this.manager.install(providerId, strategy.method as never);
      return mapInstallResult(providerId, result);
    } finally {
      this.spawnContext?.invalidate(providerId);
      this.currentProgress.delete(ctx.jobId);
    }
  }

  async uninstall(
    providerId: string,
    strategy?: UninstallStrategy
  ): Promise<Result<DependencyState, AgentUninstallError>> {
    if (!this.providersById.has(providerId)) {
      return err({ type: 'unknown-provider', providerId });
    }

    if (strategy?.kind === 'custom') {
      const run = await this.deps.installCommandRunner(strategy.command);
      if (!run.success) return err(run.error);
      const state = await this.manager.probe(providerId);
      this.spawnContext?.invalidate(providerId);
      if (state.status !== 'missing') return err({ type: 'still-present', providerId });
      return ok(state);
    }

    const result = await this.manager.uninstall(providerId, strategy?.method as never);
    this.spawnContext?.invalidate(providerId);
    return mapUninstallResult(providerId, result);
  }

  async resolveCli(providerId: string): Promise<string> {
    if (!this.providersById.has(providerId)) {
      throw new Error(`Provider '${providerId}' was not found`);
    }

    let state = this.manager.get(providerId);
    if (!state?.path) state = await this.manager.probe(providerId);
    if (state.path) return state.path;

    const descriptor = this.descriptors.find((candidate) => candidate.id === providerId);
    return descriptor?.commands[0] ?? providerId;
  }

  updateAuth(providerId: string, auth: AgentConfigEntry['auth']): void {
    const current = this.entry(providerId);
    this.publish({
      ...this.list,
      [providerId]: { ...current, auth },
    });
  }

  getAuth(providerId: string): AgentConfigEntry['auth'] {
    return this.entry(providerId).auth;
  }

  dispose(): void {
    this.deps.exec.dispose();
  }

  private seedProviders(): void {
    const now = Date.now();
    const list: AgentConfigList = {};
    for (const provider of this.deps.pluginHost.getAll()) {
      const id = provider.metadata.id;
      list[id] = {
        providerId: id,
        name: provider.metadata.name,
        install: {
          id,
          category: 'agent',
          status: 'missing',
          version: null,
          path: null,
          checkedAt: now,
        },
        auth: { status: { kind: 'unknown' }, login: null },
        installOptions: this.manager.getInstallOptions(id),
      };
    }
    this.publish(list);
  }

  private updateInstall(providerId: string, install: DependencyState): void {
    const current = this.entry(providerId);
    this.publish({
      ...this.list,
      [providerId]: { ...current, install },
    });
  }

  private entry(providerId: string): AgentConfigEntry {
    const existing = this.list[providerId];
    if (existing) return existing;
    const provider = this.providersById.get(providerId);
    return {
      providerId,
      name: provider?.metadata.name ?? providerId,
      install: {
        id: providerId,
        category: 'agent',
        status: 'missing',
        version: null,
        path: null,
        checkedAt: Date.now(),
      },
      auth: { status: { kind: 'unknown' }, login: null },
      installOptions: this.manager.getInstallOptions(providerId),
    };
  }

  private publish(list: AgentConfigList): void {
    const previous = this.list;
    this.list = list;
    publishLiveModelState(this.agentsModel.states.list, list, previous);
  }
}

function mapInstallResult(
  providerId: string,
  result: Result<DependencyState, DependencyInstallError>
): Result<DependencyState, AgentInstallError> {
  if (result.success) return result;
  return err(mapInstallError(providerId, result.error));
}

function mapUninstallResult(
  providerId: string,
  result: Result<DependencyState, DependencyUninstallError>
): Result<DependencyState, AgentUninstallError> {
  if (result.success) return result;
  return err(mapUninstallError(providerId, result.error));
}

function mapInstallError(providerId: string, error: DependencyInstallError): AgentInstallError {
  switch (error.type) {
    case 'unknown-dependency':
      return { type: 'unknown-provider', providerId };
    case 'no-install-command':
      return { type: 'no-install-command', providerId };
    case 'not-detected-after-install':
      return { type: 'not-detected-after-install', providerId };
    default:
      return error;
  }
}

function mapUninstallError(
  providerId: string,
  error: DependencyUninstallError
): AgentUninstallError {
  switch (error.type) {
    case 'unknown-dependency':
      return { type: 'unknown-provider', providerId };
    case 'no-uninstall-strategy':
      return { type: 'no-uninstall-strategy', providerId };
    case 'no-uninstall-command':
      return { type: 'no-uninstall-command', providerId };
    case 'still-present':
      return { type: 'still-present', providerId };
    default:
      return error;
  }
}

