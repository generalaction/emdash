import type { IExecutionContext } from '../../exec/execution-context';
import { Emitter } from '../../lib/emitter';
import { consoleLogger, type Logger } from '../../lib/logger';
import { err, ok, type Result } from '../../lib/result';
import type { InstallMethod, Platform } from '../capability';
import { resolveInstallOptions, pickInstallOption, toPlatform } from './install-options';
import { inferMethod } from './location-hints';
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
  DependencyUninstallResult,
  DependencyUpdateResult,
  HostDependency,
  HostDependencySelection,
  InstallCommandError,
  Installation,
  ProbeResult,
} from './types';

/**
 * Runs an install or update command string (e.g. "brew install claude") through the
 * host's shell. Deliberately not part of IExecutionContext: install commands are full
 * shell lines run through the user's shell profile (typically in a PTY), with failures
 * classified into InstallCommandError instead of thrown.
 */
export type InstallCommandRunner = (command: string) => Promise<Result<void, InstallCommandError>>;

const VERSION_RE = /(\d+\.\d+[\d.]*)/;

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
  platform?: Platform;
  /**
   * Reads the user's persisted installation selection for a dependency on this host.
   * Persistence is owned entirely by the application layer; the manager only asks
   * for the current preference when building host-scoped installation state.
   */
  getSelection?: (depId: DependencyId) => Promise<HostDependencySelection | null>;
  logger?: Logger;
  /** All dependency descriptors to manage. Injected by the application layer (e.g. desktop registry). */
  dependencies?: DependencyDescriptor[];
  /** Lookup function for a single descriptor by id. Defaults to searching `dependencies`. */
  getDependencyDescriptor?: (id: string) => DependencyDescriptor | undefined;
};

/**
 * Portable dependency manager for a single host.
 * Responsible only for probing installed versions and running install/update/uninstall
 * commands. It does NOT fetch latest published versions or compute updateAvailable — that
 * is the responsibility of the application layer (e.g. AgentUpdateService in desktop).
 * Desktop composes this with PTY install-runner, KV-backed store, and event bridge.
 */
export class HostDependencyManager {
  private state = new Map<DependencyId, DependencyState>();
  /** Host-scoped installation data, populated for agent-category deps during probe(). */
  private hostState = new Map<DependencyId, HostDependency>();

  private readonly ctx: IExecutionContext;
  private readonly runInstallCommand: InstallCommandRunner;
  private readonly connectionId: string | undefined;
  private readonly getSelection: (depId: DependencyId) => Promise<HostDependencySelection | null>;
  private readonly logger: Logger;
  private readonly _dependencies: DependencyDescriptor[];
  private readonly _getDependencyDescriptor: (id: string) => DependencyDescriptor | undefined;
  /** Platform of the target machine. Defaults to process.platform; SSH callers pass the remote platform. */
  readonly platform: Platform;

  /** Fired after every state update. */
  readonly onStatusUpdated = new Emitter<DependencyStatusUpdatedEvent>();

  /**
   * Fired when a binary's resolved-path cache should be invalidated (after
   * install / update / setSelection). Desktop bridges this to clearResolvedPathCache().
   */
  readonly onExecutableInvalidated = new Emitter<{ id: DependencyId }>();

  constructor(ctx: IExecutionContext, options: HostDependencyManagerOptions = {}) {
    this.ctx = ctx;
    this.connectionId = options.connectionId;
    this.platform = options.platform ?? toPlatform(process.platform);
    this.getSelection = options.getSelection ?? (() => Promise.resolve(null));
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
   *
   * Note: emitted state does not carry latestVersion/updateAvailable — those are
   * filled in by the application layer (AgentUpdateService) after receiving this event.
   */
  async probe(id: DependencyId): Promise<DependencyState> {
    const descriptor = this._getDependencyDescriptor(id);
    if (!descriptor) {
      throw new Error(`Unknown dependency id: ${id}`);
    }

    // Phase 1: path resolution
    const resolvedPath = await this.resolveFirstPath(descriptor);
    const pathState = dependencyStateFromProbeResult(descriptor, resolvedPath, null);
    this.updateState(pathState);

    if (pathState.status === 'missing' || descriptor.skipVersionProbe) {
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

    // Phase 3: build HostDependency for agent deps (async, non-blocking)
    if (descriptor.category === 'agent') {
      void this.buildAndStoreHostDependency(id, descriptor, resolvedPath, probeResult, fullState);
    }

    return fullState;
  }

  /**
   * Builds and stores a HostDependency for an agent dep, incorporating the
   * detected method installation plus any user-defined path/cli overrides.
   * latestVersion/updateAvailable are always null/false here; the application
   * layer enriches them after receiving the emitted event.
   */
  private async buildAndStoreHostDependency(
    id: DependencyId,
    descriptor: DependencyDescriptor,
    resolvedPath: string | null,
    probeResult: ProbeResult | null,
    fullState: DependencyState | null
  ): Promise<void> {
    const hostId = this.connectionId ?? 'local';
    const selection = await this.getSelection(id);

    const installations: Installation[] = [];

    // Primary installation: detected from realpath + method inference
    if (resolvedPath) {
      const realPath = await resolveRealpath(resolvedPath, this.ctx, this.platform);
      const inferredMethod = inferMethod(realPath, this.platform);

      installations.push({
        id: inferredMethod ? `method:${inferredMethod}` : 'auto',
        source: inferredMethod ? { kind: 'method', method: inferredMethod } : { kind: 'unknown' },
        status: fullState?.status ?? 'available',
        path: resolvedPath,
        version: fullState?.version ?? null,
        latestVersion: null,
        updateAvailable: false,
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
      installations.push(await this.probeOverrideSource(descriptor, 'path', selection.path));
    }

    // User-defined CLI override
    if (selection?.cli) {
      installations.push(await this.probeOverrideSource(descriptor, 'cli', selection.cli));
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

  /**
   * Probe a single path or cli override value without persisting or emitting any events.
   * Used both internally by buildAndStoreHostDependency and publicly by probeOverride.
   */
  private async probeOverrideSource(
    descriptor: DependencyDescriptor,
    kind: 'path' | 'cli',
    value: string
  ): Promise<Installation> {
    const versionArgs = descriptor.versionArgs ?? ['--version'];
    if (kind === 'path') {
      const pathExists = await resolveCommandPath(value, this.ctx, this.platform);
      if (pathExists) {
        const pathProbe = await runVersionProbe(value, value, versionArgs, this.ctx);
        return {
          id: 'path',
          source: { kind: 'path', path: value },
          status: dependencyStateFromProbeResult(descriptor, pathExists, pathProbe).status,
          path: pathExists,
          version: extractVersion(pathProbe),
          latestVersion: null,
          updateAvailable: false,
        };
      }
      return {
        id: 'path',
        source: { kind: 'path', path: value },
        status: 'missing',
        path: null,
        version: null,
        latestVersion: null,
        updateAvailable: false,
      };
    }

    // cli
    const cliPath = await resolveCommandPath(value, this.ctx, this.platform);
    if (cliPath) {
      const cliProbe = await runVersionProbe(value, cliPath, versionArgs, this.ctx);
      return {
        id: 'cli',
        source: { kind: 'cli', command: value },
        status: dependencyStateFromProbeResult(descriptor, cliPath, cliProbe).status,
        path: cliPath,
        version: extractVersion(cliProbe),
        latestVersion: null,
        updateAvailable: false,
      };
    }
    return {
      id: 'cli',
      source: { kind: 'cli', command: value },
      status: 'missing',
      path: null,
      version: null,
      latestVersion: null,
      updateAvailable: false,
    };
  }

  /**
   * Dry-run probe of a path or cli override value.
   * Does NOT persist any selection, mutate hostState, or emit onStatusUpdated.
   * Returns null when selection is empty.
   */
  async probeOverride(
    id: DependencyId,
    selection: { path?: string; cli?: string }
  ): Promise<Installation | null> {
    const descriptor = this._getDependencyDescriptor(id);
    if (!descriptor) throw new Error(`Unknown dependency id: ${id}`);
    if (selection.path) return this.probeOverrideSource(descriptor, 'path', selection.path);
    if (selection.cli) return this.probeOverrideSource(descriptor, 'cli', selection.cli);
    return null;
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
      // Refuse if the used installation has an unknown source — no package-manager
      // command can be selected without knowing which method installed the binary.
      const usedInstall = this.hostState
        .get(id)
        ?.installations.find((i) => i.id === (this.hostState.get(id)?.usedId ?? ''));
      if (usedInstall?.source.kind === 'unknown') {
        return err({ type: 'no-update-strategy', id });
      }

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

    const state = await this.probe(id);
    if (state.status !== 'available') {
      return err({ type: 'not-detected-after-update', id });
    }

    this.onExecutableInvalidated.emit({ id });
    return ok(state);
  }

  /**
   * Uninstall an agent dependency on this host, then re-probe to confirm it is gone.
   * Strategy is derived from the descriptor's `uninstall.kind`:
   *   - package-manager: run the per-method `uninstallCommand` from the matching InstallOption.
   *   - cli: run `<resolvedBinaryPath> <args>` (e.g. `claude uninstall`), or delegate to
   *     `updateHooks.buildUninstallCommand` for dynamic command construction.
   *   - none: return an error immediately.
   *
   * A `status: 'missing'` result after the command is the success condition — the binary
   * should be gone. There is no 'not-detected-after-uninstall' error.
   */
  async uninstall(id: DependencyId, method?: InstallMethod): Promise<DependencyUninstallResult> {
    const descriptor = this._getDependencyDescriptor(id);
    if (!descriptor) {
      return err({ type: 'unknown-dependency', id });
    }

    const strategy = descriptor.uninstall;
    if (!strategy || strategy.kind === 'none') {
      return err({ type: 'no-uninstall-strategy', id });
    }

    this.logger.info(
      `[HostDependencyManager] Uninstalling ${id} (strategy: ${strategy.kind}, method: ${method ?? 'default'})`
    );

    await this.ctx.refreshShellEnv?.();

    if (strategy.kind === 'package-manager') {
      const chosen = pickInstallOption(descriptor, this.platform, method);
      const uninstallCommand = chosen?.uninstallCommand;

      if (!uninstallCommand) {
        return err({ type: 'no-uninstall-command', id });
      }

      const runResult = await this.runInstallCommand(uninstallCommand);
      if (!runResult.success) {
        return err(runResult.error);
      }
    } else if (strategy.kind === 'cli') {
      const resolvedPath = await this.resolveFirstPath(descriptor);
      let command: string;
      let args: string[];

      if (descriptor.updateHooks?.buildUninstallCommand && resolvedPath) {
        ({ command, args } = descriptor.updateHooks.buildUninstallCommand(resolvedPath));
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

    const state = await this.probe(id);
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
      const path = await resolveCommandPath(command, this.ctx, this.platform);
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
