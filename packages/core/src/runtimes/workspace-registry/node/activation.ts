import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { noopLogger, type Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import {
  EMDASH_CONFIG_FILE,
  parseEmdashConfig,
  type EmdashScriptsConfig,
} from '#primitives/emdash-config/api';
import type { WorkspaceRuntimeOverlay } from '../api/schemas';
import {
  createWorkspaceScriptRunner,
  DEFAULT_WORKSPACE_SCRIPT_TIMEOUT_MS,
  type WorkspaceScriptRunner,
} from './script-runner';

type WorkspaceActivation = NonNullable<WorkspaceRuntimeOverlay['activation']>;
type LifecycleScript = 'prepare' | 'setup' | 'run' | 'teardown';

/** A settled activation-plane script run, as recorded durably (ADR 0006). */
export type WorkspaceScriptOutcomeReport = {
  outcome: 'succeeded' | 'failed' | 'timed-out';
  message?: string;
};

export type WorkspaceDeactivationResult = {
  /** Non-null when the teardown script settled unsuccessfully. */
  teardownFailure: { message: string } | null;
};

export type WorkspaceActivationManagerOptions = {
  /** Overlay writer: null clears the activation block. */
  publishActivation: (id: string, activation: WorkspaceActivation | null) => void;
  /** Failed scripts become overlay notices; a later success clears them. */
  setNotice: (id: string, script: LifecycleScript, message: string) => void;
  clearNotice: (id: string, script: LifecycleScript) => void;
  /**
   * Durable per-script last outcome, overwrite-in-place — the trace that survives a
   * daemon restart where notices do not. Cancelled runs are deliberate deactivations,
   * not outcomes, so they are never reported.
   */
  recordScriptOutcome: (
    id: string,
    script: 'prepare' | 'setup' | 'run',
    report: WorkspaceScriptOutcomeReport
  ) => void;
  /** Persists lastActivatedAt — the only durable trace of an activation. */
  recordActivated: (id: string, at: number) => Promise<void>;
  /**
   * The artifact gate (dependency gating): resolves once the background artifact clone
   * settled. Awaited only where scripts consume dependencies — before prepare and
   * before the setup→run chain; workspaces without those scripts never wait.
   */
  awaitArtifacts?: (id: string) => Promise<void>;
  runner?: WorkspaceScriptRunner;
  readScripts?: (workspacePath: string) => Promise<EmdashScriptsConfig>;
  clock?: Clock;
  logger?: Logger;
  teardownTimeoutMs?: number;
};

type ActiveState = {
  workspacePath: string;
  controller: AbortController;
  /** Resolves when the background setup → run chain settles (success or not). */
  background: Promise<void>;
  activation: WorkspaceActivation;
};

/**
 * The ephemeral activation plane (ADR 0005): prepare gates the verb's return, setup and
 * run continue in the background, and every script failure is a notice — never a verb
 * error. Nothing here is durable; a daemon restart leaves every workspace inactive.
 * Callers are responsible for serializing activate/deactivate per workspace.
 */
export class WorkspaceActivationManager {
  private readonly options: WorkspaceActivationManagerOptions;
  private readonly runner: WorkspaceScriptRunner;
  private readonly awaitArtifacts: (id: string) => Promise<void>;
  private readonly readScripts: (workspacePath: string) => Promise<EmdashScriptsConfig>;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly teardownTimeoutMs: number;
  private readonly active = new Map<string, ActiveState>();

  constructor(options: WorkspaceActivationManagerOptions) {
    this.options = options;
    this.runner = options.runner ?? createWorkspaceScriptRunner();
    this.awaitArtifacts = options.awaitArtifacts ?? (async () => undefined);
    this.readScripts = options.readScripts ?? readWorkspaceScripts;
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? noopLogger;
    this.teardownTimeoutMs = options.teardownTimeoutMs ?? DEFAULT_WORKSPACE_SCRIPT_TIMEOUT_MS;
  }

  isActive(id: string): boolean {
    return this.active.has(id);
  }

  /** Resolves when prepare completes; setup/run continue in the background. */
  async activate(id: string, workspacePath: string): Promise<void> {
    if (this.active.has(id)) return;

    const scripts = await this.readScripts(workspacePath);
    const controller = new AbortController();
    const state: ActiveState = {
      workspacePath,
      controller,
      background: Promise.resolve(),
      activation: {
        phase: 'preparing',
        scripts: {
          prepare: scripts.prepare ? 'running' : 'skipped',
          setup: scripts.setup ? 'pending' : 'skipped',
          run: scripts.run ? 'pending' : 'skipped',
        },
        activatedAt: null,
      },
    };
    this.active.set(id, state);
    this.publish(id, state);

    if (scripts.prepare) {
      // Prepare chains after the artifact clone (spec: clone-artifacts → prepare →
      // active), so a dep-installing prepare runs against cloned node_modules. A
      // terminal clone failure resolves the gate — prepare degrades to a real install.
      await this.awaitArtifacts(id);
      if (!this.isCurrent(id, state)) return;
      const outcome = await this.runScript(id, state, 'prepare', scripts.prepare);
      if (!this.isCurrent(id, state)) return;
      state.activation.scripts.prepare = outcome === 'succeeded' ? 'succeeded' : 'failed';
    }

    const activatedAt = this.clock.now();
    state.activation.phase = 'active';
    state.activation.activatedAt = activatedAt;
    this.publish(id, state);
    await this.options.recordActivated(id, activatedAt);

    state.background = this.runBackgroundChain(id, state, scripts).catch((error) => {
      this.logger.warn?.(`background activation scripts for '${id}' failed unexpectedly`, {
        error,
      });
    });
  }

  /**
   * Aborts in-flight scripts and runs teardown, time-boxed and never throwing. No-op
   * when the workspace is not active — teardown runs at most once per activation.
   * Session killing is the caller's step; this owns only the script plane. A teardown
   * failure is reported to the caller: notice-only for plain deactivation, a removal
   * stage for the delete verbs (ADR 0006).
   */
  async deactivate(id: string): Promise<WorkspaceDeactivationResult> {
    const state = this.active.get(id);
    if (!state) return { teardownFailure: null };
    this.active.delete(id);

    state.controller.abort();
    await state.background;

    let teardownFailure: { message: string } | null = null;
    const scripts = await this.readScripts(state.workspacePath);
    if (scripts.teardown) {
      const outcome = await this.runner.run({
        id: 'teardown',
        command: scripts.teardown,
        cwd: state.workspacePath,
        timeoutMs: this.teardownTimeoutMs,
      });
      if (outcome.status === 'succeeded') {
        this.options.clearNotice(id, 'teardown');
      } else {
        this.options.setNotice(id, 'teardown', outcome.message);
        teardownFailure = { message: outcome.message };
      }
    }
    this.options.publishActivation(id, null);
    return { teardownFailure };
  }

  /** Abandons all activations without teardown; used on runtime disposal only. */
  dispose(): void {
    for (const state of this.active.values()) {
      state.controller.abort();
    }
    this.active.clear();
  }

  private async runBackgroundChain(
    id: string,
    state: ActiveState,
    scripts: EmdashScriptsConfig
  ): Promise<void> {
    if (scripts.setup || scripts.run) {
      // Setup and run (dev servers) consume dependencies: wait for the artifact clone
      // to settle. Never gates activation itself — this chain is already background.
      await this.awaitArtifacts(id);
      if (!this.isCurrent(id, state)) return;
    }
    let setupSucceeded = true;
    if (scripts.setup) {
      state.activation.scripts.setup = 'running';
      this.publish(id, state);
      const outcome = await this.runScript(id, state, 'setup', scripts.setup);
      if (!this.isCurrent(id, state)) return;
      setupSucceeded = outcome === 'succeeded';
      state.activation.scripts.setup = setupSucceeded ? 'succeeded' : 'failed';
      this.publish(id, state);
    }

    if (!scripts.run) return;
    if (!setupSucceeded) {
      // Run waits on setup success; a failed setup means run never starts.
      state.activation.scripts.run = 'skipped';
      this.publish(id, state);
      return;
    }
    state.activation.scripts.run = 'running';
    this.publish(id, state);
    const outcome = await this.runScript(id, state, 'run', scripts.run, { longRunning: true });
    if (!this.isCurrent(id, state)) return;
    state.activation.scripts.run = outcome === 'succeeded' ? 'exited' : 'failed';
    this.publish(id, state);
  }

  private async runScript(
    id: string,
    state: ActiveState,
    script: 'prepare' | 'setup' | 'run',
    command: string,
    options: { longRunning?: boolean } = {}
  ): Promise<'succeeded' | 'failed' | 'cancelled'> {
    const outcome = await this.runner.run({
      id: script,
      command,
      cwd: state.workspacePath,
      signal: state.controller.signal,
      // Run scripts are dev-server-shaped: bounded only by deactivation, not a timeout.
      // 2^31-1 ms is Node's max timer value (~24 days), the closest thing to "never".
      ...(options.longRunning ? { timeoutMs: 2 ** 31 - 1 } : {}),
    });
    if (outcome.status === 'succeeded') {
      this.options.clearNotice(id, script);
      this.options.recordScriptOutcome(id, script, { outcome: 'succeeded' });
      return 'succeeded';
    }
    if (outcome.status === 'cancelled') {
      // Deactivation aborted it on purpose; a notice or outcome would be noise.
      return 'cancelled';
    }
    this.options.setNotice(id, script, outcome.message);
    this.options.recordScriptOutcome(id, script, {
      outcome: outcome.status === 'timed-out' ? 'timed-out' : 'failed',
      message: outcome.message,
    });
    return 'failed';
  }

  private isCurrent(id: string, state: ActiveState): boolean {
    return this.active.get(id) === state;
  }

  private publish(id: string, state: ActiveState): void {
    if (!this.isCurrent(id, state)) return;
    this.options.publishActivation(id, {
      ...state.activation,
      scripts: { ...state.activation.scripts },
    });
  }
}

async function readWorkspaceScripts(workspacePath: string): Promise<EmdashScriptsConfig> {
  let content: string;
  try {
    content = await readFile(path.join(workspacePath, EMDASH_CONFIG_FILE), 'utf8');
  } catch {
    return {};
  }
  // Lenient by design: an unparseable .emdash.json must never block activation.
  return parseEmdashConfig(content).data.scripts ?? {};
}
