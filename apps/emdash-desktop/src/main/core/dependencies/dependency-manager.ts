import type { InstallMethod, Platform } from '@emdash/cli-agent-plugins';
import { clearResolvedPathCache } from '@main/core/conversations/impl/resolve-agent-executable';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { resolveLocalAutomationShellWithSystemFallback } from '@main/core/terminal-shell/resolver';
import { events } from '@main/lib/events';
import type { IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import type {
  DependencyCategory,
  DependencyId,
  DependencyInstallResult,
  DependencyState,
  DependencyStatus,
  DependencyUpdateResult,
  HostDependency,
  HostDependencySelection,
  Installation,
} from '@shared/core/dependencies';
import { dependencyStatusUpdatedChannel } from '@shared/events/appEvents';
import { err, ok } from '@shared/lib/result';
import { hostDependencyStore, type IHostDependencyStore } from './host-dependency-store';
import { pickInstallOption, toPlatform } from './install-options';
import {
  createLocalInstallCommandRunner,
  createSshInstallCommandRunner,
  type InstallCommandRunner,
} from './install-runner';
import { LatestVersionService } from './latest-version-service';
import { inferMethod } from './location-hints';
import { resolveCommandPath, resolveRealpath, runVersionProbe } from './probe';
import { DEPENDENCIES, getDependencyDescriptor } from './registry';
import type { DependencyDescriptor, DependencyProbeOptions, ProbeResult } from './types';

const VERSION_RE = /(\d+\.\d+[\d.]*)/;

/** Returns true when latest > installed using simple numeric segment comparison. */
function isNewerVersion(installed: string, latest: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((s) => parseInt(s, 10) || 0);
  const a = parse(installed);
  const b = parse(latest);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (bi > ai) return true;
    if (ai > bi) return false;
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
  // Extract a version-like token, e.g. "git version 2.39.0" → "2.39.0"
  const m = VERSION_RE.exec(firstLine);
  return m ? m[1] : firstLine || null;
}

/** Exported alias for use inside buildAndStoreHostDependency. */
function extractVersionFromProbe(probe: ProbeResult): string | null {
  return extractVersion(probe);
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

export class DependencyManager implements IInitializable {
  private state = new Map<DependencyId, DependencyState>();
  /** Host-scoped installation data, populated for agent-category deps during probe(). */
  private hostState = new Map<DependencyId, HostDependency>();
  private readonly ctx: IExecutionContext;
  private readonly emitEvents: boolean;
  private readonly runInstallCommand: InstallCommandRunner;
  private readonly connectionId: string | undefined;
  private readonly latestVersionService: LatestVersionService;
  private readonly hostDependencyStore: IHostDependencyStore | undefined;
  /** Platform of the target machine. Local defaults to process.platform; SSH resolves via remote probe. */
  readonly platform: Platform;

  constructor(
    ctx: IExecutionContext,
    {
      emitEvents = true,
      runInstallCommand,
      connectionId,
      latestVersionService = new LatestVersionService(),
      platform = toPlatform(process.platform),
      hostDependencyStore: injectedHostDepStore,
    }: {
      emitEvents?: boolean;
      runInstallCommand?: InstallCommandRunner;
      connectionId?: string;
      latestVersionService?: LatestVersionService;
      platform?: Platform;
      hostDependencyStore?: IHostDependencyStore;
    } = {}
  ) {
    this.ctx = ctx;
    this.emitEvents = emitEvents;
    this.runInstallCommand =
      runInstallCommand ?? createLocalInstallCommandRunner(resolveLocalInstallShellProfile);
    this.connectionId = connectionId;
    this.latestVersionService = latestVersionService;
    this.platform = platform;
    this.hostDependencyStore = injectedHostDepStore;
  }

  /**
   * Kick off background probing for all dependencies. Returns immediately;
   * results stream in via `dependencyStatusUpdatedChannel` events.
   */
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
      const desc = getDependencyDescriptor(s.id);
      return desc?.category === cat;
    });
  }

  /** Returns the host-scoped installation data for an agent dep, if available. */
  getHostDependency(id: DependencyId): HostDependency | undefined {
    return this.hostState.get(id);
  }

  /**
   * Two-phase probe for a single dependency:
   *   1. Resolve path (fast, ~5ms) — emits an event immediately.
   *   2. Run version probe (slow, up to 10s) — emits a second event on completion.
   *
   * For agent-category deps, also builds a HostDependency with per-installation
   * status (detected method + any user-defined path/cli overrides).
   */
  async probe(id: DependencyId): Promise<DependencyState> {
    const descriptor = getDependencyDescriptor(id);
    if (!descriptor) {
      throw new Error(`Unknown dependency id: ${id}`);
    }

    // Phase 1: path resolution
    // Carry forward latestVersion/updateAvailable from any previous probe so they
    // are not temporarily cleared while the version probe and latest-version fetch
    // have not yet run. This prevents the "Update available" badge from blinking.
    const resolvedPath = await this.resolveFirstPath(descriptor);
    const pathState = dependencyStateFromProbeResult(descriptor, resolvedPath, null);
    const prev = this.state.get(id);
    this.updateState({
      ...pathState,
      latestVersion: prev?.latestVersion,
      updateAvailable: prev?.updateAvailable,
    });

    if (pathState.status === 'missing' || descriptor.skipVersionProbe) {
      // Still fetch the latest version for missing agents so the UI can show what
      // version is available to install, even before the agent is present.
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
      const prevHostDep = this.hostState.get(id);
      const prevPrimary = prevHostDep?.installations.find(
        (i) => i.source.kind === 'method' || (i.source.kind === 'cli' && i.id === 'auto')
      );

      installations.push({
        id: inferredMethod ? `method:${inferredMethod}` : 'auto',
        source: inferredMethod
          ? { kind: 'method', method: inferredMethod }
          : { kind: 'cli', command: descriptor.commands[0] ?? id },
        status: fullState?.status ?? 'available',
        path: resolvedPath,
        version: fullState?.version ?? null,
        latestVersion: prevPrimary?.latestVersion ?? fullState?.latestVersion ?? null,
        updateAvailable: prevPrimary?.updateAvailable ?? fullState?.updateAvailable ?? false,
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
          version: extractVersionFromProbe(pathProbe),
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
          version: extractVersionFromProbe(cliProbe),
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
    if (this.emitEvents) {
      events.emit(dependencyStatusUpdatedChannel, {
        id,
        state: this.state.get(id)!,
        connectionId: this.connectionId,
        hostDependency,
      });
    }
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
    clearResolvedPathCache(id, this.connectionId);
    await this.probe(id);
  }

  /**
   * Fetch the latest version for a dependency and update state.
   * Exposed publicly for on-demand refresh (e.g. from the RPC controller).
   */
  async fetchLatestVersion(id: DependencyId): Promise<void> {
    const descriptor = getDependencyDescriptor(id);
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
  }

  async probeAll(options: DependencyProbeOptions = {}): Promise<void> {
    await this.refreshShellEnvIfRequested(options);
    await Promise.all(
      DEPENDENCIES.map((d) =>
        this.probe(d.id).catch((err) => {
          log.warn(`[DependencyManager] Failed to probe ${d.id}:`, err);
        })
      )
    );
  }

  async probeCategory(
    cat: DependencyCategory,
    options: DependencyProbeOptions = {}
  ): Promise<void> {
    await this.refreshShellEnvIfRequested(options);
    const targets = DEPENDENCIES.filter((d) => d.category === cat);
    await Promise.all(
      targets.map((d) =>
        this.probe(d.id).catch((err) => {
          log.warn(`[DependencyManager] Failed to probe ${d.id}:`, err);
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
    const descriptor = getDependencyDescriptor(id);
    if (!descriptor) {
      return err({ type: 'unknown-dependency', id });
    }

    const command =
      pickInstallOption(descriptor, this.platform, method)?.command ?? descriptor.installCommand;

    if (!command) {
      return err({ type: 'no-install-command', id });
    }

    log.info(`[DependencyManager] Installing ${id}: ${command}`);

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

    clearResolvedPathCache(id);
    return ok(state);
  }

  /**
   * Apply an available update for an agent dependency, then re-probe.
   * Strategy is derived from capabilities.updates.update.kind:
   *   - package-manager: re-run the update command for the matching InstallOption (or the
   *     recommended/first option when no method is provided). Falls back to `descriptor.installCommand`.
   *   - cli: run `<resolvedBinaryPath> <args>` (e.g. `claude update`), method-agnostic.
   *   - auto / none: no-op
   */
  async update(id: DependencyId, method?: InstallMethod): Promise<DependencyUpdateResult> {
    const descriptor = getDependencyDescriptor(id);
    if (!descriptor) {
      return err({ type: 'unknown-dependency', id });
    }

    const updates = descriptor.updates;
    if (!updates || updates.kind !== 'supported') {
      return err({ type: 'no-update-strategy', id });
    }

    const strategy = updates.update;

    if (strategy.kind === 'auto' || strategy.kind === 'none') {
      // No action: agent self-updates or has no update mechanism.
      const state = this.state.get(id);
      if (state) return ok(state);
      return err({ type: 'no-update-strategy', id });
    }

    log.info(
      `[DependencyManager] Updating ${id} (strategy: ${strategy.kind}, method: ${method ?? 'default'})`
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

    clearResolvedPathCache(id);
    return ok(state);
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
    if (this.emitEvents) {
      events.emit(dependencyStatusUpdatedChannel, {
        id: state.id,
        state,
        connectionId: this.connectionId,
      });
    }
  }
}

async function resolveLocalInstallShellProfile() {
  const { defaultShell } = await appSettingsService.get('terminal');
  return await resolveLocalAutomationShellWithSystemFallback({
    intent: defaultShell,
    onFallback: (error) => {
      log.warn('[DependencyManager] Preferred install shell unavailable, using fallback', {
        shell: error.shell,
        target: error.target,
      });
    },
  });
}

export const localDependencyManager = new DependencyManager(new LocalExecutionContext(), {
  hostDependencyStore,
});

const sshManagers = new Map<string, DependencyManager>();

/** Resolve the OS platform of a remote machine via a lightweight `uname -s` probe. */
async function resolveRemotePlatform(ctx: IExecutionContext): Promise<Platform> {
  try {
    const { stdout } = await ctx.exec('uname', ['-s'], { timeout: 5000 });
    const os = stdout.trim().toLowerCase();
    if (os === 'darwin') return 'macos';
    return 'linux';
  } catch {
    // Windows hosts won't have uname; default to linux for other unknowns.
    return 'linux';
  }
}

export async function getDependencyManager(connectionId?: string): Promise<DependencyManager> {
  if (!connectionId) return localDependencyManager;
  let mgr = sshManagers.get(connectionId);
  if (!mgr) {
    const proxy = await sshConnectionManager.connect(connectionId);
    const sshCtx = new SshExecutionContext(proxy);
    const platform = await resolveRemotePlatform(sshCtx);
    mgr = new DependencyManager(sshCtx, {
      emitEvents: true,
      runInstallCommand: createSshInstallCommandRunner(proxy),
      connectionId,
      platform,
      hostDependencyStore,
    });
    sshManagers.set(connectionId, mgr);
  }
  return mgr;
}
