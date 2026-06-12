import semver from 'semver';
import type { IExecutionContext } from '../../exec/execution-context';
import { Emitter } from '../../lib/emitter';
import { consoleLogger, type Logger } from '../../lib/logger';
import { err, ok } from '../../lib/result';
import type { InstallMethod, Platform } from '../capability';
import { resolveInstallOptions, pickInstallOption, toPlatform } from './install-options';
import { LatestVersionService } from './latest-version-service';
import { inferMethod } from './location-hints';
import type { IHostDependencyStore, InstallCommandRunner } from './ports';
import { resolveCommandPath, resolveRealpath, runVersionProbe } from './probe';
import type {
  DependencyCategory,
  DependencyDescriptor,
  DependencyId,
  DependencyInstallResult,
  DependencyProbeOptions,
  DependencyState,
  DependencyStatus,
  DependencyStatusUpdatedEvent,
  DependencyUpdateResult,
  HostDependency,
  HostDependencySelection,
  Installation,
  ProbeResult,
} from './types';

const VERSION_RE = /(\d+\.\d+[\d.]*)/;

function isNewerVersion(installed: string, latest: string): boolean {
  const a = semver.coerce(installed);
  const b = semver.coerce(latest);
  if (a === null || b === null) return false;
  return semver.gt(b, a);
}

function resolveProbeStatus(
  descriptor: DependencyDescriptor,
  resolvedPath: string | null,
  probe: ProbeResult
): DependencyStatus {
  if (descriptor.resolveStatus) {
    return descriptor.resolveStatus(probe);
  }
  if (resolvedPath !== null) return 'available';
  if (probe.exitCode !== null && (probe.stdout || probe.stderr)) return 'available';
  if (probe.timedOut && probe.stdout) return 'available';
  return probe.exitCode === null ? 'missing' : 'error';
}

function extractVersion(probe: ProbeResult): string | null {
  const raw = (probe.stdout || probe.stderr).trim();
  const firstLine = raw.split('\n')[0]?.trim() ?? '';
  const m = VERSION_RE.exec(firstLine);
  return m ? m[1] : firstLine || null;
}

function dependencyStateFromProbeResult(
  descriptor: DependencyDescriptor,
  resolvedPath: string | null,
  probe: ProbeResult | null
): DependencyState {
  let status: DependencyStatus;
  let version: string | null = null;

  if (probe === null) {
    status = resolvedPath !== null ? 'available' : 'missing';
  } else {
    status = resolveProbeStatus(descriptor, resolvedPath, probe);
  }

  if (status === 'available' && probe) {
    version = extractVersion(probe);
  }

  return {
    id: descriptor.id,
    category: descriptor.category,
    status,
    version,
    path: resolvedPath,
    checkedAt: Date.now(),
    error: status === 'error' ? probe?.stderr?.trim() || 'Unknown error' : undefined,
  };
}

export type HostDependencyManagerOptions = {
  /**
   * Runs install / update command strings.
   * Required when `install()` or `update()` will be called.
   */
  runInstallCommand?: InstallCommandRunner;
  connectionId?: string;
  latestVersionService?: LatestVersionService;
  platform?: Platform;
  hostDependencyStore?: IHostDependencyStore;
  logger?: Logger;
  /** All dependency descriptors to manage. Injected by the application layer (e.g. desktop registry). */
  dependencies?: DependencyDescriptor[];
  /** Lookup function for a single descriptor by id. Defaults to searching `dependencies`. */
  getDependencyDescriptor?: (id: string) => DependencyDescriptor | undefined;
};

/**
 * Portable dependency manager for a single host.
 * Desktop composes this with PTY install-runner, KV-backed store, and event
 * bridge. Workspace Server will compose it with a plain-shell runner and a
 * file/sqlite store. Neither transport is imported here.
 */
export class HostDependencyManager {
  private state = new Map<DependencyId, DependencyState>();
  /** Host-scoped installation data, populated for agent-category deps during probe(). */
  private hostState = new Map<DependencyId, HostDependency>();

  private readonly ctx: IExecutionContext;
  private readonly runInstallCommand: InstallCommandRunner;
  private readonly connectionId: string | undefined;
  private readonly latestVersionService: LatestVersionService;
  private readonly hostDependencyStore: IHostDependencyStore | undefined;
  private readonly logger: Logger;
  private readonly _dependencies: DependencyDescriptor[];
  private readonly _getDependencyDescriptor: (id: string) => DependencyDescriptor | undefined;
  /** Platform of the target machine. Defaults to process.platform; SSH callers pass the remote platform. */
  readonly platform: Platform;

  /** Fired after every state update — replace `events.emit(dependencyStatusUpdatedChannel, ...)`. */
  readonly onStatusUpdated = new Emitter<DependencyStatusUpdatedEvent>();

  /**
   * Fired when a binary's resolved-path cache should be invalidated (after
   * install / update / setSelection). Desktop bridges this to clearResolvedPathCache().
   */
  readonly onExecutableInvalidated = new Emitter<{ id: DependencyId }>();

  constructor(ctx: IExecutionContext, options: HostDependencyManagerOptions = {}) {
    this.ctx = ctx;
    this.connectionId = options.connectionId;
    this.latestVersionService = options.latestVersionService ?? new LatestVersionService();
    this.platform = options.platform ?? toPlatform(process.platform);
    this.hostDependencyStore = options.hostDependencyStore;
    this.logger = options.logger ?? consoleLogger;
    this._dependencies = options.dependencies ?? [];
    this._getDependencyDescriptor =
      options.getDependencyDescriptor ?? ((id) => this._dependencies.find((d) => d.id === id));
    this.runInstallCommand =
      options.runInstallCommand ??
      (() =>
        Promise.resolve(
          err({
            type: 'command-failed' as const,
            message: 'No install runner configured',
            output: '',
            exitCode: undefined,
          })
        ));
  }

  /** Kick off background probing for all dependencies. Returns immediately. */
  initialize(): void {
    void this.probeAll();
  }

  getAll(): Map<DependencyId, DependencyState> {
    return new Map(this.state);
  }

  get(id: DependencyId): DependencyState | undefined {
    return this.state.get(id);
  }

  getByCategory(cat: DependencyCategory): DependencyState[] {
    return [...this.state.values()].filter((s) => {
      const desc = this._getDependencyDescriptor(s.id);
      return desc?.category === cat;
    });
  }

  /** Returns the host-scoped installation data for an agent dep, if available. */
  getHostDependency(id: DependencyId): HostDependency | undefined {
    return this.hostState.get(id);
  }

  /**
   * Two-phase probe for a single dependency:
   *   1. Resolve path (fast, ~5ms) — fires onStatusUpdated immediately.
   *   2. Run version probe (slow, up to 10s) — fires a second update on completion.
   *
   * For agent-category deps, also builds a HostDependency with per-installation
   * status (detected method + any user-defined path/cli overrides).
   */
  async probe(id: DependencyId): Promise<DependencyState> {
    const descriptor = this._getDependencyDescriptor(id);
    if (!descriptor) {
      throw new Error(`Unknown dependency id: ${id}`);
    }

    // Phase 1: path resolution — carry forward latestVersion/updateAvailable to avoid badge blink
    const resolvedPath = await this.resolveFirstPath(descriptor);
    const pathState = dependencyStateFromProbeResult(descriptor, resolvedPath, null);
    const prev = this.state.get(id);
    this.updateState({
      ...pathState,
      latestVersion: prev?.latestVersion,
      updateAvailable: prev?.updateAvailable,
    });

    if (pathState.status === 'missing' || descriptor.skipVersionProbe) {
      void this.fetchAndUpdateLatestVersion(descriptor, pathState);
      if (descriptor.category === 'agent') {
        void this.buildAndStoreHostDependency(id, descriptor, null, null, null);
      }
      return pathState;
    }

    // Phase 2: version probe
    const versionArgs = descriptor.versionArgs ?? ['--version'];
    const probeResult = await runVersionProbe(
      descriptor.commands[0] ?? id,
      resolvedPath,
      versionArgs,
      this.ctx
    );
    const fullState = dependencyStateFromProbeResult(descriptor, resolvedPath, probeResult);
    this.updateState(fullState);

    // Phase 3: fetch latest version (async, non-blocking for the return value)
    void this.fetchAndUpdateLatestVersion(descriptor, fullState);

    // Phase 4: build HostDependency for agent deps (async, non-blocking)
    if (descriptor.category === 'agent') {
      void this.buildAndStoreHostDependency(id, descriptor, resolvedPath, probeResult, fullState);
    }

    return fullState;
  }

  /**
   * Builds and stores a HostDependency for an agent dep, incorporating the
   * detected method installation plus any user-defined path/cli overrides.
   */
  private async buildAndStoreHostDependency(
    id: DependencyId,
    descriptor: DependencyDescriptor,
    resolvedPath: string | null,
    probeResult: ProbeResult | null,
    fullState: DependencyState | null
  ): Promise<void> {
    const hostId = this.connectionId ?? 'local';
    const selection = await this.hostDependencyStore?.getSelection(hostId, id);
    const versionArgs = descriptor.versionArgs ?? ['--version'];

    const installations: Installation[] = [];

    // Primary installation: detected from realpath + method inference
    if (resolvedPath) {
      const realPath = await resolveRealpath(resolvedPath, this.ctx);
      const inferredMethod = inferMethod(realPath, this.platform);
      // Prefer the freshest aggregate state: the latest-version fetch may have
      // completed before this runs and already enriched it with updateAvailable.
      const currentState = this.state.get(id) ?? fullState;

      installations.push({
        id: inferredMethod ? `method:${inferredMethod}` : 'auto',
        source: inferredMethod
          ? { kind: 'method', method: inferredMethod }
          : { kind: 'cli', command: descriptor.commands[0] ?? id },
        status: fullState?.status ?? 'available',
        path: resolvedPath,
        version: fullState?.version ?? null,
        latestVersion: currentState?.latestVersion ?? null,
        updateAvailable: currentState?.updateAvailable ?? false,
      });
    } else {
      // Not found — still include as a placeholder so UI can show "not installed"
      installations.push({
        id: 'auto',
        source: { kind: 'cli', command: descriptor.commands[0] ?? id },
        status: 'missing',
        path: null,
        version: null,
        latestVersion: null,
        updateAvailable: false,
      });
    }

    // User-defined path override
    if (selection?.path) {
      const pathExists = await resolveCommandPath(selection.path, this.ctx);
      if (pathExists) {
        const pathProbe = await runVersionProbe(
          selection.path,
          selection.path,
          versionArgs,
          this.ctx
        );
        installations.push({
          id: 'path',
          source: { kind: 'path', path: selection.path },
          status: dependencyStateFromProbeResult(descriptor, pathExists, pathProbe).status,
          path: pathExists,
          version: extractVersion(pathProbe),
          latestVersion: null,
          updateAvailable: false,
        });
      } else {
        installations.push({
          id: 'path',
          source: { kind: 'path', path: selection.path },
          status: 'missing',
          path: null,
          version: null,
          latestVersion: null,
          updateAvailable: false,
        });
      }
    }

    // User-defined CLI override
    if (selection?.cli) {
      const cliPath = await resolveCommandPath(selection.cli, this.ctx);
      if (cliPath) {
        const cliProbe = await runVersionProbe(selection.cli, cliPath, versionArgs, this.ctx);
        installations.push({
          id: 'cli',
          source: { kind: 'cli', command: selection.cli },
          status: dependencyStateFromProbeResult(descriptor, cliPath, cliProbe).status,
          path: cliPath,
          version: extractVersion(cliProbe),
          latestVersion: null,
          updateAvailable: false,
        });
      } else {
        installations.push({
          id: 'cli',
          source: { kind: 'cli', command: selection.cli },
          status: 'missing',
          path: null,
          version: null,
          latestVersion: null,
          updateAvailable: false,
        });
      }
    }

    // Derive usedId: stored selection → recommended install option → first valid → first
    const usedId = this.deriveUsedId(id, descriptor, installations, selection);

    const hostDependency: HostDependency = {
      hostId,
      dependencyId: id,
      installations,
      usedId,
    };

    this.hostState.set(id, hostDependency);
    this.onStatusUpdated.emit({
      id,
      state: this.state.get(id)!,
      connectionId: this.connectionId,
      hostDependency,
    });
  }

  private deriveUsedId(
    id: DependencyId,
    descriptor: DependencyDescriptor,
    installations: Installation[],
    selection: HostDependencySelection | null | undefined
  ): string {
    // 1. Stored selection if it matches a known installation
    if (selection?.usedId) {
      if (installations.some((i) => i.id === selection.usedId)) {
        return selection.usedId;
      }
    }

    // 2. Recommended install option for this platform
    const recommended = pickInstallOption(descriptor, this.platform);
    if (recommended) {
      const methodId = `method:${recommended.method}`;
      const inst = installations.find((i) => i.id === methodId);
      if (inst) return methodId;
    }

    // 3. First valid (available) installation
    const firstValid = installations.find((i) => i.status === 'available');
    if (firstValid) return firstValid.id;

    // 4. First installation as fallback
    return installations[0]?.id ?? 'auto';
  }

  /**
   * Persist a host-scoped installation selection and re-probe to update state.
   */
  async setSelection(id: DependencyId, selection: HostDependencySelection): Promise<void> {
    if (!this.hostDependencyStore) return;
    const hostId = this.connectionId ?? 'local';
    await this.hostDependencyStore.setSelection(hostId, id, selection);
    this.onExecutableInvalidated.emit({ id });
    await this.probe(id);
  }

  /**
   * Fetch the latest version for a dependency and update state.
   * Exposed publicly for on-demand refresh (e.g. from the RPC controller).
   */
  async fetchLatestVersion(id: DependencyId): Promise<void> {
    const descriptor = this._getDependencyDescriptor(id);
    if (!descriptor) return;
    const state = this.state.get(id);
    if (!state) return;
    await this.fetchAndUpdateLatestVersion(descriptor, state);
  }

  private async fetchAndUpdateLatestVersion(
    descriptor: DependencyDescriptor,
    state: DependencyState
  ): Promise<void> {
    if (!descriptor.updates || descriptor.updates.kind !== 'supported') return;

    const { releaseSource } = descriptor.updates;
    if (releaseSource.kind === 'none') return;

    let latestVersion: string | null;
    if (descriptor.updateHooks?.resolveLatestVersion) {
      try {
        latestVersion = await descriptor.updateHooks.resolveLatestVersion();
      } catch {
        latestVersion = null;
      }
    } else {
      latestVersion = await this.latestVersionService.fetchLatestVersion(releaseSource);
    }

    const updateAvailable =
      latestVersion !== null && state.version !== null
        ? isNewerVersion(state.version, latestVersion)
        : false;

    const enrichedState: DependencyState = { ...state, latestVersion, updateAvailable };
    this.updateState(enrichedState);

    // Keep the per-installation updateAvailable/latestVersion in sync with the
    // freshly fetched latest version. Without this, the aggregate state reports
    // an available update while the stored installations (read by the UI's
    // update card via `used.updateAvailable`) stay stale at the probe-time value.
    this.propagateLatestVersionToHostDependency(state.id, latestVersion);
  }

  /**
   * Re-derives each stored installation's `latestVersion`/`updateAvailable` from
   * the given latest version and re-emits the HostDependency so renderers patch
   * their cached installations.
   */
  private propagateLatestVersionToHostDependency(
    id: DependencyId,
    latestVersion: string | null
  ): void {
    const hostDependency = this.hostState.get(id);
    if (!hostDependency) return;

    const installations = hostDependency.installations.map((inst) => {
      if (inst.version === null) return inst;
      const updateAvailable =
        latestVersion !== null ? isNewerVersion(inst.version, latestVersion) : false;
      return { ...inst, latestVersion, updateAvailable };
    });

    const updated: HostDependency = { ...hostDependency, installations };
    this.hostState.set(id, updated);
    this.onStatusUpdated.emit({
      id,
      state: this.state.get(id)!,
      connectionId: this.connectionId,
      hostDependency: updated,
    });
  }

  async probeAll(options: DependencyProbeOptions = {}): Promise<void> {
    await this.refreshShellEnvIfRequested(options);
    await Promise.all(
      this._dependencies.map((d) =>
        this.probe(d.id).catch((probErr) => {
          this.logger.warn(`[HostDependencyManager] Failed to probe ${d.id}:`, probErr);
        })
      )
    );
  }

  async probeCategory(
    cat: DependencyCategory,
    options: DependencyProbeOptions = {}
  ): Promise<void> {
    await this.refreshShellEnvIfRequested(options);
    const targets = this._dependencies.filter((d) => d.category === cat);
    await Promise.all(
      targets.map((d) =>
        this.probe(d.id).catch((probErr) => {
          this.logger.warn(`[HostDependencyManager] Failed to probe ${d.id}:`, probErr);
        })
      )
    );
  }

  /**
   * Run the installCommand for a dependency, then re-probe to update state.
   * When `method` is provided, picks the matching InstallOption for the manager's platform;
   * otherwise picks the recommended/first option. Falls back to descriptor.installCommand.
   */
  async install(id: DependencyId, method?: InstallMethod): Promise<DependencyInstallResult> {
    const descriptor = this._getDependencyDescriptor(id);
    if (!descriptor) {
      return err({ type: 'unknown-dependency', id });
    }

    const command =
      pickInstallOption(descriptor, this.platform, method)?.command ?? descriptor.installCommand;

    if (!command) {
      return err({ type: 'no-install-command', id });
    }

    this.logger.info(`[HostDependencyManager] Installing ${id}: ${command}`);

    await this.ctx.refreshShellEnv?.();

    const installResult = await this.runInstallCommand(command);
    if (!installResult.success) {
      return err(installResult.error);
    }

    await this.ctx.refreshShellEnv?.();

    const state = await this.probe(id);
    if (state.status !== 'available') {
      return err({ type: 'not-detected-after-install', id });
    }

    this.onExecutableInvalidated.emit({ id });
    return ok(state);
  }

  /**
   * Apply an available update for an agent dependency, then re-probe.
   * Strategy is derived from capabilities.updates.update.kind:
   *   - package-manager: re-run the update command for the matching InstallOption.
   *   - cli: run `<resolvedBinaryPath> <args>` (e.g. `claude update`).
   *   - auto / none: no-op
   */
  async update(id: DependencyId, method?: InstallMethod): Promise<DependencyUpdateResult> {
    const descriptor = this._getDependencyDescriptor(id);
    if (!descriptor) {
      return err({ type: 'unknown-dependency', id });
    }

    const updates = descriptor.updates;
    if (!updates || updates.kind !== 'supported') {
      return err({ type: 'no-update-strategy', id });
    }

    const strategy = updates.update;

    if (strategy.kind === 'auto' || strategy.kind === 'none') {
      const state = this.state.get(id);
      if (state) return ok(state);
      return err({ type: 'no-update-strategy', id });
    }

    this.logger.info(
      `[HostDependencyManager] Updating ${id} (strategy: ${strategy.kind}, method: ${method ?? 'default'})`
    );

    await this.ctx.refreshShellEnv?.();

    if (strategy.kind === 'package-manager') {
      const chosen = pickInstallOption(descriptor, this.platform, method);
      const updateCommand = chosen?.updateCommand ?? chosen?.command ?? descriptor.installCommand;

      if (!updateCommand) {
        return err({ type: 'no-update-strategy', id });
      }

      const runResult = await this.runInstallCommand(updateCommand);
      if (!runResult.success) {
        return err(runResult.error);
      }
    } else if (strategy.kind === 'cli') {
      const resolvedPath = await this.resolveFirstPath(descriptor);
      let command: string;
      let args: string[];

      if (descriptor.updateHooks?.buildUpdateCommand && resolvedPath) {
        ({ command, args } = descriptor.updateHooks.buildUpdateCommand(resolvedPath));
      } else {
        command = resolvedPath ?? descriptor.commands[0] ?? id;
        args = strategy.args;
      }

      const commandLine = [command, ...args].join(' ');
      const runResult = await this.runInstallCommand(commandLine);
      if (!runResult.success) {
        return err(runResult.error);
      }
    }

    await this.ctx.refreshShellEnv?.();

    // Invalidate latest-version cache so the next probe re-fetches
    if (updates.releaseSource.kind !== 'none') {
      this.latestVersionService.invalidate(updates.releaseSource);
    }

    const state = await this.probe(id);
    if (state.status !== 'available') {
      return err({ type: 'not-detected-after-update', id });
    }

    this.onExecutableInvalidated.emit({ id });
    return ok(state);
  }

  /** Returns the resolved install options for an agent dep on the current platform. */
  getInstallOptions(id: DependencyId) {
    const descriptor = this._getDependencyDescriptor(id);
    if (!descriptor) return [];
    return resolveInstallOptions(descriptor, this.platform);
  }

  private async resolveFirstPath(descriptor: DependencyDescriptor): Promise<string | null> {
    for (const command of descriptor.commands) {
      const path = await resolveCommandPath(command, this.ctx);
      if (path) return path;
    }
    return null;
  }

  private async refreshShellEnvIfRequested(options: DependencyProbeOptions = {}): Promise<void> {
    if (options.refreshShellEnv) {
      await this.ctx.refreshShellEnv?.();
    }
  }

  private updateState(state: DependencyState): void {
    this.state.set(state.id, state);
    this.onStatusUpdated.emit({
      id: state.id,
      state,
      connectionId: this.connectionId,
    });
  }
}
