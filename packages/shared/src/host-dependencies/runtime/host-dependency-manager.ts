import type { IExecutionContext } from '../../exec/execution-context';
import { Emitter } from '../../lib/emitter';
import { consoleLogger, type Logger } from '../../lib/logger';
import { err, ok, type Result } from '../../lib/result';
import type { InstallMethod, Platform } from '../capability';
import { resolveInstallOptions, pickInstallOption, toPlatform } from './install-options';
import { createInstallMethodDetector, type InstallMethodDetector } from './method-detection';
import {
  resolveAllCommandPaths,
  resolveCommandPath,
  resolveRealpath,
  runVersionProbe,
} from './probe';
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
  Provenance,
  SelectedSource,
} from './types';
import { resolveActiveInstallation, resolveSelectedSource } from './types';

/**
 * Runs an install or update command string (e.g. "brew install claude") through the
 * host's shell. Deliberately not part of IExecutionContext: install commands are full
 * shell lines run through the user's shell profile (typically in a PTY), with failures
 * classified into InstallCommandError instead of thrown.
 */
export type InstallCommandRunner = (command: string) => Promise<Result<void, InstallCommandError>>;

const VERSION_RE = /(\d+\.\d+[\d.]*)/;

/** Methods that are non-PM origins — cannot be used for PM routing. */
const NON_PM_KINDS = new Set(['manual', 'version-manager', 'unknown']);

/** Returns true when a provenance kind is a real InstallMethod that can be PM-routed. */
function isRealInstallMethod(kind: Provenance['kind'] | null | undefined): kind is InstallMethod {
  return !!kind && !NON_PM_KINDS.has(kind);
}

/**
 * Derives whether emdash can manage (update/uninstall) an installation given its
 * provenance and the dependency's update/uninstall strategy.
 *
 * - CLI strategy: always manageable (binary self-updates regardless of install source)
 * - package-manager strategy: manageable only when provenance is confirmed (we know the PM)
 * - none / auto / absent: not manageable
 */
function computeManageable(provenance: Provenance, descriptor: DependencyDescriptor): boolean {
  const updates = descriptor.updates;
  const strategyKind = updates?.kind === 'supported' ? updates.update.kind : 'none';
  const uninstallKind = descriptor.uninstall?.kind ?? 'none';

  if (strategyKind === 'cli' || uninstallKind === 'cli') return true;
  if (strategyKind === 'package-manager' || uninstallKind === 'package-manager') {
    return provenance.confidence === 'confirmed';
  }
  return false;
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
   * status (enumerated via which -a + path/cli overrides).
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
        void this.buildAndStoreHostDependency(id, descriptor, null, null);
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
    if (descriptor.category === 'agent') {
      void this.buildAndStoreHostDependency(id, descriptor, fullState, probeResult);
    }

    return fullState;
  }

  /**
   * Enumerate all installed copies of a dependency binary by running `which -a`
   * (or `where` on Windows) for all configured command names.
   *
   * Each discovered path is:
   *   1. realpathd to the canonical path (following symlinks)
   *   2. Deduplicated by realpath
   *   3. Marked isActive = true for the first PATH hit overall
   *   4. Probed for version
   *   5. Classified by the provenance detector
   *   6. Assessed for manageability
   *
   * The primary binary name (`descriptor.commands[0]`) is used for `which -a`;
   * additional command names are tried only if the first produces no results, to
   * handle renamed binaries across versions.
   */
  private async enumerateInstallations(
    descriptor: DependencyDescriptor,
    fullState: DependencyState | null
  ): Promise<Installation[]> {
    const installations: Installation[] = [];
    const seenRealpaths = new Set<string>();

    // Try each command in order; stop once we get PATH hits to avoid mixing
    // different binary names (e.g., claude-code vs claude).
    let allPaths: string[] = [];
    for (const command of descriptor.commands) {
      allPaths = await resolveAllCommandPaths(command, this.ctx, this.platform);
      if (allPaths.length > 0) break;
    }

    const primaryCommand = descriptor.commands[0] ?? descriptor.id;
    const versionArgs = descriptor.versionArgs ?? ['--version'];

    for (let i = 0; i < allPaths.length; i++) {
      const pathEntry = allPaths[i]!;
      const isFirstOverall = i === 0;

      const realpath = await resolveRealpath(pathEntry, this.ctx, this.platform);

      if (seenRealpaths.has(realpath)) continue;
      seenRealpaths.add(realpath);

      const isActive = isFirstOverall;
      const provenance = await this.detector.detect(realpath);
      const manageable = computeManageable(provenance, descriptor);

      // For the active (first) installation, reuse the already-computed fullState
      // to avoid a redundant version probe.
      let version: string | null = null;
      let status: DependencyStatus = 'available';

      if (isActive && fullState) {
        version = fullState.version;
        status = fullState.status;
      } else if (!descriptor.skipVersionProbe) {
        const probe = await runVersionProbe(primaryCommand, pathEntry, versionArgs, this.ctx);
        status = resolveProbeStatus(descriptor, pathEntry, probe);
        if (status === 'available') version = extractVersion(probe);
      }

      installations.push({
        id: realpath,
        realpath,
        pathEntry,
        isActive,
        manageable,
        provenance,
        status,
        version,
        latestVersion: null,
        updateAvailable: false,
      });
    }

    return installations;
  }

  /**
   * Builds and stores a HostDependency for an agent dep.
   *
   * Enumerates all discovered installations via `which -a`, classifies each by
   * provenance, and appends any path/cli override installations from the persisted
   * selection. The `used` source is read from the KV store; missing → auto.
   *
   * latestVersion/updateAvailable are always null/false here; the application
   * layer enriches them after receiving the emitted event.
   */
  private async buildAndStoreHostDependency(
    id: DependencyId,
    descriptor: DependencyDescriptor,
    fullState: DependencyState | null,
    _probeResult: ProbeResult | null
  ): Promise<void> {
    const hostId = this.connectionId ?? 'local';
    const selection = await this.getSelection(id);
    const used: SelectedSource = resolveSelectedSource(selection);

    // Enumerate all discovered installations
    const installations = await this.enumerateInstallations(descriptor, fullState);

    // Path override: probe when explicitly selected or previously saved
    if (selection?.kind === 'path') {
      installations.push(await this.probeOverrideSource(descriptor, 'path', selection.path));
    }

    // CLI override: probe when explicitly selected or previously saved
    if (selection?.kind === 'cli') {
      installations.push(await this.probeOverrideSource(descriptor, 'cli', selection.command));
    }

    // If nothing is on PATH and the descriptor was probed missing, ensure at least
    // one entry so the UI can show "not found".
    if (installations.length === 0 && (fullState === null || fullState.status === 'missing')) {
      // Add a sentinel missing entry so resolveActiveInstallation(auto) returns a
      // missing status instead of undefined (which also maps to 'missing').
      // This is optional but makes event payloads more explicit for the update service.
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
   *
   * Override installations use fixed ids ('path'/'cli') to preserve backward compatibility
   * with lookups by sourceKey('path'|'cli').
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
        const realpath = await resolveRealpath(pathExists, this.ctx, this.platform);
        const pathProbe = await runVersionProbe(value, value, versionArgs, this.ctx);
        const status = dependencyStateFromProbeResult(descriptor, pathExists, pathProbe).status;
        return {
          id: 'path',
          realpath,
          pathEntry: value,
          isActive: false,
          manageable: false,
          provenance: { kind: 'unknown', confidence: 'inferred' },
          status,
          version: status === 'available' ? extractVersion(pathProbe) : null,
          latestVersion: null,
          updateAvailable: false,
        };
      }
      return {
        id: 'path',
        realpath: value,
        pathEntry: value,
        isActive: false,
        manageable: false,
        provenance: { kind: 'unknown', confidence: 'inferred' },
        status: 'missing',
        version: null,
        latestVersion: null,
        updateAvailable: false,
      };
    }

    // cli
    const cliPath = await resolveCommandPath(value, this.ctx, this.platform);
    if (cliPath) {
      const realpath = await resolveRealpath(cliPath, this.ctx, this.platform);
      const cliProbe = await runVersionProbe(value, cliPath, versionArgs, this.ctx);
      const status = dependencyStateFromProbeResult(descriptor, cliPath, cliProbe).status;
      return {
        id: 'cli',
        realpath,
        pathEntry: value,
        isActive: false,
        manageable: false,
        provenance: { kind: 'unknown', confidence: 'inferred' },
        status,
        version: status === 'available' ? extractVersion(cliProbe) : null,
        latestVersion: null,
        updateAvailable: false,
      };
    }
    return {
      id: 'cli',
      realpath: value,
      pathEntry: value,
      isActive: false,
      manageable: false,
      provenance: { kind: 'unknown', confidence: 'inferred' },
      status: 'missing',
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
   * Resolves the update/uninstall command based on effective method and descriptor.
   *
   * effectiveMethod semantics:
   *   - InstallMethod: known method → use PM routing
   *   - null:          probed but no method → refuse PM; CLI only
   *   - undefined:     no probe yet → fall back to recommended option
   */
  private resolveUpdatePlan(
    effectiveMethod: InstallMethod | null | undefined,
    descriptor: DependencyDescriptor,
    operation: 'update' | 'uninstall'
  ):
    | { kind: 'package-manager'; command: string }
    | { kind: 'cli'; command: string; args: string[] }
    | { kind: 'none' } {
    const updates = descriptor.updates;
    const strategyKind = updates?.kind === 'supported' ? updates.update.kind : 'none';

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
      // No prior probe — fall back to the recommended install option
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
   * After a successful install, invalidates the detector cache so re-probe picks up
   * the new binary's provenance correctly.
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
    this.detector.invalidate();

    const state = await this.probe(id);
    if (state.status !== 'available') {
      return err({ type: 'not-detected-after-install', id });
    }

    this.onExecutableInvalidated.emit({ id });
    return ok(state);
  }

  /**
   * Apply an available update for an agent dependency, then re-probe.
   * Routing is driven by the active installation's provenance: method selection
   * uses PM commands, unknown/manual sources fall back to CLI self-update.
   * When `method` is explicitly passed it overrides the provenance-based routing.
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

    // Determine effective routing method from provenance or explicit override
    let effectiveMethod: InstallMethod | null | undefined;

    if (method) {
      effectiveMethod = method;
    } else {
      const hostDep = this.hostState.get(id);
      const storedSelection = await this.getSelection(id);
      const selection: SelectedSource = resolveSelectedSource(storedSelection);

      if (hostDep !== undefined) {
        const activeInst = resolveActiveInstallation(hostDep.installations, selection);
        if (activeInst && !activeInst.manageable) {
          return err({ type: 'no-update-strategy', id });
        }
        const provKind = activeInst?.provenance.kind;
        effectiveMethod = isRealInstallMethod(provKind) ? (provKind as InstallMethod) : null;
      } else {
        effectiveMethod = undefined; // no probe yet — use recommended
      }
    }

    this.logger.info(
      `[HostDependencyManager] Updating ${id} (effectiveMethod: ${String(effectiveMethod ?? 'none')})`
    );

    await this.ctx.refreshShellEnv?.();

    const plan = this.resolveUpdatePlan(effectiveMethod, descriptor, 'update');

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
    this.detector.invalidate();

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
   * Routing is driven by the active installation's provenance: method selections use
   * PM uninstall commands when available (e.g. `brew uninstall <formula>`), otherwise
   * fall back to CLI self-uninstall. `manageable === false` → no-uninstall-strategy.
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

    // Determine effective routing method
    let effectiveMethod: InstallMethod | null | undefined;

    if (method) {
      effectiveMethod = method;
    } else {
      const hostDep = this.hostState.get(id);
      const storedSelection = await this.getSelection(id);
      const selection: SelectedSource = resolveSelectedSource(storedSelection);

      if (hostDep !== undefined) {
        const activeInst = resolveActiveInstallation(hostDep.installations, selection);
        const provKind = activeInst?.provenance.kind;
        effectiveMethod = isRealInstallMethod(provKind) ? (provKind as InstallMethod) : null;
      } else {
        effectiveMethod = undefined; // no probe yet — use recommended
      }
    }

    this.logger.info(
      `[HostDependencyManager] Uninstalling ${id} (effectiveMethod: ${String(effectiveMethod ?? 'none')})`
    );

    await this.ctx.refreshShellEnv?.();

    const plan = this.resolveUpdatePlan(effectiveMethod, descriptor, 'uninstall');

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
    this.detector.invalidate();

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
