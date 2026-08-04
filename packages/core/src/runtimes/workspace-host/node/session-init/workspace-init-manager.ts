import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createKeyedLanes } from '@emdash/shared/concurrency';
import { log } from '@emdash/shared/logger';
import {
  EMDASH_CONFIG_FILE,
  parseEmdashConfig,
  type EmdashConfig,
} from '@primitives/emdash-config/api';
import {
  createWorkspaceScriptRunner,
  type WorkspaceScriptRunOutcome,
  type WorkspaceScriptRunner,
} from './script-runner';

export type WorkspaceConfiguredScript = 'prepare' | 'setup' | 'run' | 'teardown';

export type WorkspaceNotice = {
  path: string;
  script: WorkspaceConfiguredScript;
  status: 'failed' | 'timed-out' | 'cancelled';
  message: string;
  exitCode?: number;
  outputTail: string;
  at: number;
};

export type WorkspaceInitializationResult = {
  active: true;
  prepare: WorkspaceScriptRunResult;
  notices: WorkspaceNotice[];
};

export type WorkspaceScriptRunResult =
  | WorkspaceScriptRunOutcome
  | { status: 'skipped'; outputTail: '' };

export type WorkspaceInitManagerOptions = {
  runner?: WorkspaceScriptRunner;
  readConfig?: (workspacePath: string) => Promise<string | null>;
  now?: () => number;
  onNoticesChanged?: (notices: Readonly<Record<string, readonly WorkspaceNotice[]>>) => void;
};

type WorkspaceInitState = {
  configVersion: string;
  generation: number;
  controller: AbortController;
  prepare: 'pending' | 'running' | 'succeeded' | 'failed';
  setup: 'pending' | 'running' | 'succeeded' | 'failed';
  active: boolean;
  setupPromise?: Promise<WorkspaceScriptRunOutcome>;
};

export class WorkspaceInitManager {
  readonly #runner: WorkspaceScriptRunner;
  readonly #readConfig: (workspacePath: string) => Promise<string | null>;
  readonly #now: () => number;
  readonly #onNoticesChanged?: WorkspaceInitManagerOptions['onNoticesChanged'];
  readonly #states = new Map<string, WorkspaceInitState>();
  readonly #notices = new Map<string, Map<WorkspaceConfiguredScript, WorkspaceNotice>>();
  readonly #lanes = createKeyedLanes();
  readonly #epochs = new Map<string, number>();
  #nextGeneration = 1;

  constructor(options: WorkspaceInitManagerOptions = {}) {
    this.#runner = options.runner ?? createWorkspaceScriptRunner();
    this.#readConfig = options.readConfig ?? readWorkspaceConfig;
    this.#now = options.now ?? Date.now;
    this.#onNoticesChanged = options.onNoticesChanged;
  }

  async initialize(
    workspacePath: string,
    signal?: AbortSignal
  ): Promise<WorkspaceInitializationResult> {
    const preflight = await this.#loadConfig(workspacePath);
    throwIfAborted(signal);
    const current = this.#states.get(workspacePath);
    if (current && current.configVersion !== preflight.version) current.controller.abort();
    const epoch = this.#epoch(workspacePath);
    return await this.#lanes.run(workspacePath, signal ?? neverAbortedSignal(), async () => {
      if (epoch !== this.#epoch(workspacePath)) throw abortError();
      const loaded = await this.#loadConfig(workspacePath);
      throwIfAborted(signal);
      let state = this.#states.get(workspacePath);
      if (!state || state.configVersion !== loaded.version || state.controller.signal.aborted) {
        if (state) await this.#stopState(state);
        throwIfAborted(signal);
        state = {
          configVersion: loaded.version,
          generation: this.#nextGeneration++,
          controller: new AbortController(),
          prepare: 'pending',
          setup: 'pending',
          active: false,
        };
        this.#states.set(workspacePath, state);
      }

      if (state.active && state.prepare === 'succeeded') {
        this.#startSetup(workspacePath, loaded.config, state);
        return this.#result(workspacePath, { status: 'skipped', outputTail: '' });
      }

      const runSignal = combineSignals(state.controller.signal, signal);
      try {
        return await this.#initializeState(workspacePath, loaded.config, state, runSignal);
      } catch (error) {
        if (isAbortError(error) && this.#isCurrent(workspacePath, state)) {
          state.controller.abort();
          this.#states.delete(workspacePath);
        }
        throw error;
      }
    });
  }

  async runConfiguredScript(
    workspacePath: string,
    script: WorkspaceConfiguredScript,
    signal?: AbortSignal
  ): Promise<WorkspaceScriptRunResult> {
    const requested = await this.#loadConfig(workspacePath, true);
    const current = this.#states.get(workspacePath);
    if (current?.active && current.configVersion !== requested.version) {
      await this.initialize(workspacePath, signal);
    }
    const epoch = this.#epoch(workspacePath);
    return await this.#lanes.run(workspacePath, signal ?? neverAbortedSignal(), async () => {
      if (epoch !== this.#epoch(workspacePath)) throw abortError();
      const state = this.#states.get(workspacePath);
      if (!state?.active) throw new Error(`Workspace ${workspacePath} is not active`);
      const { config, version } = await this.#loadConfig(workspacePath, true);
      if (state.configVersion !== version) {
        throw new Error('Workspace configuration changed; initialize the workspace again');
      }
      const command = config.scripts?.[script];
      if (!command) {
        this.#clearNotice(workspacePath, script);
        return { status: 'skipped', outputTail: '' };
      }
      if (script === 'run') {
        const setupReady = await this.#waitForSetup(workspacePath, version, signal);
        if (!setupReady) {
          return {
            status: 'failed',
            message: 'The setup script must succeed before the run script can start',
            outputTail: '',
          };
        }
      } else if (script === 'setup' && state.setupPromise) {
        await raceWithAbort(state.setupPromise, signal);
      }
      const outcome = await this.#run(
        workspacePath,
        script,
        command,
        combineSignals(state.controller.signal, signal)
      );
      if (this.#isCurrent(workspacePath, state)) {
        if (script === 'prepare') {
          state.prepare = outcome.status === 'succeeded' ? 'succeeded' : 'failed';
        } else if (script === 'setup') {
          state.setup = outcome.status === 'succeeded' ? 'succeeded' : 'failed';
        }
      }
      return outcome;
    });
  }

  async getConfiguredScript(
    workspacePath: string,
    script: WorkspaceConfiguredScript
  ): Promise<string | undefined> {
    const { config } = await this.#loadConfig(workspacePath, true);
    return config.scripts?.[script];
  }

  isActive(workspacePath: string): boolean {
    return this.#states.get(workspacePath)?.active === true;
  }

  async shutdown(workspacePath: string): Promise<void> {
    this.#beginShutdown(workspacePath);
    await this.#lanes.run(workspacePath, neverAbortedSignal(), async () => {
      await this.#finishShutdown(workspacePath);
    });
  }

  async shutdownAndRunCapturedScript(
    workspacePath: string,
    script: WorkspaceConfiguredScript,
    command: string,
    signal?: AbortSignal
  ): Promise<WorkspaceScriptRunOutcome> {
    this.#beginShutdown(workspacePath);
    return await this.#lanes.run(workspacePath, signal ?? neverAbortedSignal(), async () => {
      await this.#finishShutdown(workspacePath);
      return await this.#run(workspacePath, script, command, signal);
    });
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.#states.keys()].map((workspacePath) => this.shutdown(workspacePath))
    );
  }

  reportFailure(
    workspacePath: string,
    script: WorkspaceConfiguredScript,
    error: unknown
  ): WorkspaceNotice {
    const notice: WorkspaceNotice = {
      path: workspacePath,
      script,
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      outputTail: '',
      at: this.#now(),
    };
    this.#setNotice(notice);
    return notice;
  }

  getNotices(): Readonly<Record<string, readonly WorkspaceNotice[]>> {
    return Object.fromEntries(
      [...this.#notices].map(([workspacePath, notices]) => [
        workspacePath,
        [...notices.values()].sort((left, right) => left.at - right.at),
      ])
    );
  }

  async #initializeState(
    workspacePath: string,
    config: EmdashConfig,
    state: WorkspaceInitState,
    signal?: AbortSignal
  ): Promise<WorkspaceInitializationResult> {
    const prepare = config.scripts?.prepare;
    let prepareResult: WorkspaceScriptRunResult = { status: 'skipped', outputTail: '' };
    state.prepare = 'running';
    if (prepare) {
      prepareResult = await this.#run(workspacePath, 'prepare', prepare, signal);
      if (prepareResult.status === 'cancelled' && signal?.aborted) throw abortError();
      if (!this.#isCurrent(workspacePath, state)) throw abortError();
      state.prepare = prepareResult.status === 'succeeded' ? 'succeeded' : 'failed';
    } else {
      state.prepare = 'succeeded';
      this.#clearNotice(workspacePath, 'prepare');
    }

    state.active = true;
    this.#startSetup(workspacePath, config, state);
    return this.#result(workspacePath, prepareResult);
  }

  #startSetup(workspacePath: string, config: EmdashConfig, state: WorkspaceInitState): void {
    const setup = config.scripts?.setup;
    if (!setup || state.setup !== 'pending') {
      if (!setup) {
        state.setup = 'succeeded';
        this.#clearNotice(workspacePath, 'setup');
      }
      return;
    }

    state.setup = 'running';
    state.setupPromise = this.#run(workspacePath, 'setup', setup, state.controller.signal).then(
      (outcome) => {
        if (this.#isCurrent(workspacePath, state)) {
          state.setup = outcome.status === 'succeeded' ? 'succeeded' : 'failed';
          state.setupPromise = undefined;
        }
        return outcome;
      }
    );
  }

  async #run(
    workspacePath: string,
    script: WorkspaceConfiguredScript,
    command: string,
    signal?: AbortSignal
  ): Promise<WorkspaceScriptRunOutcome> {
    const outcome = await this.#runner.run({
      id: script,
      command,
      cwd: workspacePath,
      signal,
    });
    if (outcome.status === 'succeeded') {
      this.#clearNotice(workspacePath, script);
      return outcome;
    }

    const notice: WorkspaceNotice = {
      path: workspacePath,
      script,
      status: outcome.status,
      message: outcome.message,
      ...(outcome.exitCode === undefined ? {} : { exitCode: outcome.exitCode }),
      outputTail: outcome.outputTail,
      at: this.#now(),
    };
    this.#setNotice(notice);
    return outcome;
  }

  async #loadConfig(
    workspacePath: string,
    strict = false
  ): Promise<{ config: EmdashConfig; version: string }> {
    const content = await this.#readConfig(workspacePath);
    if (content === null) return { config: {}, version: '' };
    const parsed = parseEmdashConfig(content);
    if (!parsed.success) {
      if (strict) throw parsed.error;
      log.warn('Failed to parse workspace .emdash.json; using defaults', {
        path: workspacePath,
        error: parsed.error,
      });
    }
    this.#clearRemovedScriptNotices(workspacePath, parsed.data);
    return {
      config: parsed.data,
      version: content,
    };
  }

  #result(workspacePath: string, prepare: WorkspaceScriptRunResult): WorkspaceInitializationResult {
    return {
      active: true,
      prepare,
      notices: [...(this.#notices.get(workspacePath)?.values() ?? [])],
    };
  }

  async #waitForSetup(
    workspacePath: string,
    configVersion: string,
    signal?: AbortSignal
  ): Promise<boolean> {
    const state = this.#states.get(workspacePath);
    if (!state?.active || state.configVersion !== configVersion) return false;
    if (state.setupPromise) {
      await raceWithAbort(state.setupPromise, signal);
    }
    const current = this.#states.get(workspacePath);
    return current?.configVersion === configVersion && current.setup === 'succeeded';
  }

  async #stopState(state: WorkspaceInitState): Promise<void> {
    state.controller.abort();
    if (state.setupPromise) await Promise.allSettled([state.setupPromise]);
  }

  #beginShutdown(workspacePath: string): void {
    this.#epochs.set(workspacePath, this.#epoch(workspacePath) + 1);
    this.#states.get(workspacePath)?.controller.abort();
  }

  async #finishShutdown(workspacePath: string): Promise<void> {
    const state = this.#states.get(workspacePath);
    if (!state) return;
    await this.#stopState(state);
    if (this.#isCurrent(workspacePath, state)) {
      state.active = false;
      this.#states.delete(workspacePath);
    }
  }

  #isCurrent(workspacePath: string, state: WorkspaceInitState): boolean {
    return this.#states.get(workspacePath)?.generation === state.generation;
  }

  #epoch(workspacePath: string): number {
    return this.#epochs.get(workspacePath) ?? 0;
  }

  #setNotice(notice: WorkspaceNotice): void {
    const workspaceNotices =
      this.#notices.get(notice.path) ?? new Map<WorkspaceConfiguredScript, WorkspaceNotice>();
    workspaceNotices.set(notice.script, notice);
    this.#notices.set(notice.path, workspaceNotices);
    this.#publishNotices();
  }

  #clearNotice(workspacePath: string, script: WorkspaceConfiguredScript): void {
    const workspaceNotices = this.#notices.get(workspacePath);
    if (!workspaceNotices?.delete(script)) return;
    if (workspaceNotices.size === 0) this.#notices.delete(workspacePath);
    this.#publishNotices();
  }

  #clearRemovedScriptNotices(workspacePath: string, config: EmdashConfig): void {
    for (const script of ['prepare', 'setup', 'run', 'teardown'] as const) {
      if (!config.scripts?.[script]) this.#clearNotice(workspacePath, script);
    }
  }

  #publishNotices(): void {
    this.#onNoticesChanged?.(this.getNotices());
  }
}

function neverAbortedSignal(): AbortSignal {
  return new AbortController().signal;
}

function combineSignals(first: AbortSignal, second?: AbortSignal): AbortSignal {
  return second ? AbortSignal.any([first, second]) : first;
}

async function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return await promise;
  throwIfAborted(signal);
  return await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(abortError()), { once: true });
    }),
  ]);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  return Object.assign(new Error('Workspace initialization was cancelled'), {
    name: 'AbortError',
    code: 'ABORT_ERR',
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function readWorkspaceConfig(workspacePath: string): Promise<string | null> {
  try {
    return await readFile(path.join(workspacePath, EMDASH_CONFIG_FILE), 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
