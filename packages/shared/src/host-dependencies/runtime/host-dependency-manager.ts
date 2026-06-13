import type { IExecutionContext } from '../../exec/execution-context';
import { Emitter } from '../../lib/emitter';
import { consoleLogger, type Logger } from '../../lib/logger';
import { err, ok, type Result } from '../../lib/result';
import type { InstallMethod, Platform } from '../capability';
import { resolveInstallOptions, pickInstallOption, toPlatform } from './install-options';
import { createInstallMethodDetector, type InstallMethodDetector } from './method-detection';
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
  InstallOverride,
  Installation,
  ProbeResult,
  SelectedSource,
} from './types';
import { resolveSelectedSource, sourceKey } from './types';

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
  /**
   * Override the install-method detector. Defaults to createInstallMethodDetector(ctx, platform).
   * Inject a stub in tests to avoid live brew/npm queries.
   */
  installMethodDetector?: InstallMethodDetector;
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
  private readonly detector: InstallMethodDetector;
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
    this.detector =
      options.installMethodDetector ?? createInstallMethodDetector(this.ctx, this.platform);
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
        // Fire-and-forget: hostState is populated asynchronously after probe() returns.
        // Callers that need the unknown-source guard (update()) must either await probe()
        // first or tolerate a missing hostState entry on first call.
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

    // Phase 3: build HostDependency for agent deps (async, non-blocking).
    // Same fire-and-forget caveat as above.
    if (descriptor.category === 'agent') {
      void this.buildAndStoreHostDependency(id, descriptor, resolvedPath, probeResult, fullState);
    }

    return fullState;
  }

  /**
   * Builds and stores a HostDependency for an agent dep.
   *
   * The authoritative 'used' source is the persisted override (or auto when none).
   * We always emit one 'auto' installation reflecting the PATH probe, and one
   * installation per override kind present in the selection.
   *
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
    const used: SelectedSource = resolveSelectedSource(selection);

    const installations: Installation[] = [];

    // Auto installation: reflects what is found on PATH (with inferredMethod hint)
    if (resolvedPath) {
      const realPath = await resolveRealpath(resolvedPath, this.ctx, this.platform);
      const inferred = await this.detector.detect(realPath);
      installations.push({
        id: 'auto',
        source: { kind: 'auto' },
        inferredMethod: inferred,
        status: fullState?.status ?? 'available',
        path: resolvedPath,
        version: fullState?.version ?? null,
        latestVersion: null,
        updateAvailable: false,
      });
    } else {
      installations.push({
        id: 'auto',
        source: { kind: 'auto' },
        inferredMethod: null,
        status: 'missing',
        path: null,
        version: null,
        latestVersion: null,
        updateAvailable: false,
      });
    }

    // Path override installation (probe it when selected or previously saved)
    if (selection?.kind === 'path') {
      installations.push(await this.probeOverrideSource(descriptor, 'path', selection.path));
    }

    // CLI override installation
    if (selection?.kind === 'cli') {
      installations.push(await this.probeOverrideSource(descriptor, 'cli', selection.command));
    }

    // Method selection: record the selected method as an additional installation entry
    // so the status card can display its status distinctly from auto.
    //
    // The user explicitly chose this method (e.g. they installed via it), so trust
    // that choice: when the binary is present on PATH (auto is available), the
    // selected method is available too — inheriting auto's path/version. We do NOT
    // gate this on inferredMethod matching the selection, because path-based method
    // inference is only a best-effort routing hint for auto-updates and frequently
    // disagrees with the real install method (e.g. Homebrew node CLIs resolve under
    // node_modules). Gating on it wrongly reported explicit installs as missing.
    if (selection?.kind === 'method') {
      const autoInst = installations.find((i) => i.id === 'auto');
      const present = autoInst?.status === 'available';
      installations.push({
        id: sourceKey(used),
        source: used as InstallOverride,
        inferredMethod: autoInst?.inferredMethod ?? null,
        status: present ? 'available' : 'missing',
        path: present ? (autoInst?.path ?? null) : null,
        version: present ? (autoInst?.version ?? null) : null,
        latestVersion: null,
        updateAvailable: false,
      });
    }

    const hostDependency: HostDependency = {
      hostId,
      dependencyId: id,
      installations,
      used,
    };

    this.hostState.set(id, hostDependency);
    const currentState = this.state.get(id);
    if (!currentState) return;
    this.onStatusUpdated.emit({
      id,
      state: currentState,
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
          inferredMethod: null,
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
        inferredMethod: null,
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
        inferredMethod: null,
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
      inferredMethod: null,
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

  /**
   * Resolves the update/uninstall command based on selection and inferred method.
   *
   * inferredMethod semantics:
   *   - InstallMethod: probed + method known → use that method for PM routing
   *   - null:          probed but no method → refuse PM for auto (unknown source)
   *   - undefined:     no probe yet → fall back to recommended option (backward compat)
   */
  private resolveUpdatePlan(
    selection: SelectedSource,
    inferredMethod: InstallMethod | null | undefined,
    descriptor: DependencyDescriptor,
    operation: 'update' | 'uninstall'
  ):
    | { kind: 'package-manager'; command: string }
    | { kind: 'cli'; command: string; args: string[] }
    | { kind: 'none' } {
    const updates = descriptor.updates;
    const strategyKind = updates?.kind === 'supported' ? updates.update.kind : 'none';

    const effectiveMethod: InstallMethod | null | undefined =
      selection.kind === 'method'
        ? selection.method
        : selection.kind === 'auto'
          ? inferredMethod
          : null; // path/cli → no PM routing

    if (effectiveMethod != null) {
      // Known method: route to the matching PM option
      const opt = pickInstallOption(descriptor, this.platform, effectiveMethod);
      if (opt) {
        if (operation === 'uninstall' && opt.uninstallCommand) {
          return { kind: 'package-manager', command: opt.uninstallCommand };
        }
        if (operation === 'update') {
          const cmd = opt.updateCommand ?? opt.command;
          if (cmd) return { kind: 'package-manager', command: cmd };
        }
      }
    } else if (effectiveMethod === undefined) {
      // No prior probe — fall back to the recommended install option (old behavior)
      const fallback = pickInstallOption(descriptor, this.platform);
      if (fallback) {
        if (operation === 'uninstall' && fallback.uninstallCommand) {
          return { kind: 'package-manager', command: fallback.uninstallCommand };
        }
        if (operation === 'update') {
          const cmd = fallback.updateCommand ?? fallback.command;
          if (cmd) return { kind: 'package-manager', command: cmd };
        }
      }
    }
    // effectiveMethod === null (probed + no inferred or path/cli) → skip PM, try CLI

    // CLI strategy fallback
    if (operation === 'update' && strategyKind === 'cli' && updates?.kind === 'supported') {
      return {
        kind: 'cli',
        command: '',
        args: (updates.update as { kind: 'cli'; args: string[] }).args,
      };
    }
    if (operation === 'uninstall' && descriptor.uninstall?.kind === 'cli') {
      return { kind: 'cli', command: '', args: descriptor.uninstall.args };
    }

    return { kind: 'none' };
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
   * Run the install command for a dependency, then re-probe to update state.
   * When `method` is provided, picks the matching InstallOption for the manager's platform;
   * otherwise picks the recommended/first option.
   */
  async install(id: DependencyId, method?: InstallMethod): Promise<DependencyInstallResult> {
    const descriptor = this._getDependencyDescriptor(id);
    if (!descriptor) {
      return err({ type: 'unknown-dependency', id });
    }

    const command = pickInstallOption(descriptor, this.platform, method)?.command;

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
   * Routing is driven by resolveUpdatePlan: method selection uses PM commands,
   * auto selection routes through inferredMethod (falls back to CLI), path/cli use CLI.
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

    if (updates.update.kind === 'auto' || updates.update.kind === 'none') {
      const state = this.state.get(id);
      if (state) return ok(state);
      return err({ type: 'no-update-strategy', id });
    }

    // Determine the effective selection: caller-supplied method overrides stored selection
    const hostDep = this.hostState.get(id);
    const storedSelection = await this.getSelection(id);
    const selection: SelectedSource = method
      ? { kind: 'method', method }
      : resolveSelectedSource(storedSelection);
    const autoInst = hostDep?.installations.find((i) => i.id === 'auto');
    // undefined = no probe yet (fall back to recommended); null = probed but no method inferred
    const inferredMethod: InstallMethod | null | undefined =
      hostDep !== undefined ? (autoInst?.inferredMethod ?? null) : undefined;

    this.logger.info(
      `[HostDependencyManager] Updating ${id} (selection: ${selection.kind}, inferredMethod: ${String(inferredMethod ?? 'none')})`
    );

    await this.ctx.refreshShellEnv?.();

    const plan = this.resolveUpdatePlan(selection, inferredMethod, descriptor, 'update');

    if (plan.kind === 'package-manager') {
      const runResult = await this.runInstallCommand(plan.command);
      if (!runResult.success) return err(runResult.error);
    } else if (plan.kind === 'cli') {
      const resolvedPath = await this.resolveFirstPath(descriptor);
      let command: string;
      let args: string[];

      if (descriptor.commandHooks?.buildUpdateCommand && resolvedPath) {
        ({ command, args } = descriptor.commandHooks.buildUpdateCommand(resolvedPath));
      } else {
        command = resolvedPath ?? descriptor.commands[0] ?? id;
        args = plan.args;
      }

      const commandLine = [command, ...args].join(' ');
      const runResult = await this.runInstallCommand(commandLine);
      if (!runResult.success) return err(runResult.error);
    } else {
      return err({ type: 'no-update-strategy', id });
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
   *
   * Routing is driven by resolveUpdatePlan: method/auto selections use PM uninstall
   * commands when available (e.g. `brew uninstall`), otherwise fall back to CLI self-uninstall.
   *
   * A `status: 'missing'` result after the command is the success condition.
   * Returns a 'still-present' error when the binary is still found after the command completes.
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

    // Determine the effective selection
    const hostDep = this.hostState.get(id);
    const storedSelection = await this.getSelection(id);
    const selection: SelectedSource = method
      ? { kind: 'method', method }
      : resolveSelectedSource(storedSelection);
    const autoInst = hostDep?.installations.find((i) => i.id === 'auto');
    // undefined = no probe yet (fall back to recommended); null = probed but no method inferred
    const inferredMethod: InstallMethod | null | undefined =
      hostDep !== undefined ? (autoInst?.inferredMethod ?? null) : undefined;

    this.logger.info(
      `[HostDependencyManager] Uninstalling ${id} (selection: ${selection.kind}, inferredMethod: ${String(inferredMethod ?? 'none')})`
    );

    await this.ctx.refreshShellEnv?.();

    const plan = this.resolveUpdatePlan(selection, inferredMethod, descriptor, 'uninstall');

    if (plan.kind === 'package-manager') {
      const runResult = await this.runInstallCommand(plan.command);
      if (!runResult.success) return err(runResult.error);
    } else if (plan.kind === 'cli') {
      const resolvedPath = await this.resolveFirstPath(descriptor);
      let command: string;
      let args: string[];

      if (descriptor.commandHooks?.buildUninstallCommand && resolvedPath) {
        ({ command, args } = descriptor.commandHooks.buildUninstallCommand(resolvedPath));
      } else {
        command = resolvedPath ?? descriptor.commands[0] ?? id;
        args = plan.args;
      }

      const commandLine = [command, ...args].join(' ');
      const runResult = await this.runInstallCommand(commandLine);
      if (!runResult.success) return err(runResult.error);
    } else {
      return err({ type: 'no-uninstall-command', id });
    }

    await this.ctx.refreshShellEnv?.();

    const state = await this.probe(id);
    this.onExecutableInvalidated.emit({ id });

    if (state.status === 'available') {
      return err({ type: 'still-present', id });
    }

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
