import { EventEmitter } from 'node:events';
import path from 'node:path';
import { promisify } from 'node:util';
import { lifecycleScriptsService } from './LifecycleScriptsService';
import {
  type LifecycleEvent,
  type LifecycleLogs,
  type LifecyclePhase,
  type LifecyclePhaseState,
  type TaskLifecycleState,
  MAX_LIFECYCLE_LOG_LINES,
  formatLifecycleLogLine,
} from '@shared/lifecycle';
import { getTaskEnvVars } from '@shared/task/envVars';
import { execFile } from 'node:child_process';
import { log } from '../lib/logger';
import { buildExternalToolEnv } from '../utils/childProcessEnv';
import { startLifecyclePty, type LifecyclePtyHandle } from './ptyManager';

const execFileAsync = promisify(execFile);

type LifecycleResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

class TaskLifecycleService extends EventEmitter {
  private states = new Map<string, TaskLifecycleState>();
  private logBuffers = new Map<string, LifecycleLogs>();
  private runPtys = new Map<string, LifecyclePtyHandle>();
  private finitePtys = new Map<string, Set<LifecyclePtyHandle>>();
  private runStartInflight = new Map<string, Promise<LifecycleResult>>();
  private setupInflight = new Map<string, Promise<LifecycleResult>>();
  private teardownInflight = new Map<string, Promise<LifecycleResult>>();
  private stopIntents = new Set<string>();

  private nowIso(): string {
    return new Date().toISOString();
  }

  private inflightKey(taskId: string, taskPath: string): string {
    return `${taskId}::${taskPath}`;
  }

  private trackFinitePty(taskId: string, pty: LifecyclePtyHandle): () => void {
    const set = this.finitePtys.get(taskId) ?? new Set<LifecyclePtyHandle>();
    set.add(pty);
    this.finitePtys.set(taskId, set);
    return () => {
      const current = this.finitePtys.get(taskId);
      if (!current) return;
      current.delete(pty);
      if (current.size === 0) {
        this.finitePtys.delete(taskId);
      }
    };
  }

  private createLifecyclePty(
    id: string,
    script: string,
    cwd: string,
    env: NodeJS.ProcessEnv
  ): LifecyclePtyHandle {
    return startLifecyclePty({
      id,
      command: script,
      cwd,
      env,
    });
  }

  private waitForPtyExit(
    handle: LifecyclePtyHandle,
    isTracked: () => boolean,
    timeoutMs: number,
    timeoutMessage: string
  ): Promise<void> {
    if (!isTracked()) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        log.warn(timeoutMessage);
        finish();
      }, timeoutMs);
      handle.onExit(() => finish());
      if (!isTracked()) {
        finish();
      }
    });
  }

  private async resolveDefaultBranch(projectPath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
        { cwd: projectPath }
      );
      const ref = stdout.trim();
      if (ref) {
        return ref.replace(/^origin\//, '');
      }
    } catch {}

    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: projectPath,
      });
      const branch = stdout.trim();
      if (branch && branch !== 'HEAD') {
        return branch;
      }
    } catch {}

    return 'main';
  }

  private async buildLifecycleEnv(
    taskId: string,
    taskPath: string,
    projectPath: string,
    taskName?: string
  ): Promise<NodeJS.ProcessEnv> {
    const defaultBranch = await this.resolveDefaultBranch(projectPath);
    taskName = taskName || path.basename(taskPath) || taskId;
    const taskEnv = getTaskEnvVars({
      taskId,
      taskName,
      taskPath,
      projectPath,
      defaultBranch,
      portSeed: taskPath || taskId,
    });
    return { ...buildExternalToolEnv(process.env), ...taskEnv };
  }

  private createPhaseState(): LifecyclePhaseState {
    return { status: 'idle', error: null, exitCode: null };
  }

  private defaultState(taskId: string): TaskLifecycleState {
    return {
      taskId,
      setup: this.createPhaseState(),
      run: { ...this.createPhaseState(), pid: null },
      teardown: this.createPhaseState(),
    };
  }

  private ensureState(taskId: string): TaskLifecycleState {
    const existing = this.states.get(taskId);
    if (existing) return existing;
    const state = this.defaultState(taskId);
    this.states.set(taskId, state);
    return state;
  }

  private ensureLogBuffer(taskId: string): LifecycleLogs {
    const existing = this.logBuffers.get(taskId);
    if (existing) return existing;
    const buf: LifecycleLogs = { setup: [], run: [], teardown: [] };
    this.logBuffers.set(taskId, buf);
    return buf;
  }

  private appendLog(taskId: string, phase: LifecyclePhase, line: string): void {
    const buf = this.ensureLogBuffer(taskId);
    const arr = buf[phase];
    arr.push(line);
    if (arr.length > MAX_LIFECYCLE_LOG_LINES) {
      arr.splice(0, arr.length - MAX_LIFECYCLE_LOG_LINES);
    }
  }

  private buildErrorDetail(taskId: string, phase: LifecyclePhase, baseError: string): string {
    const buf = this.logBuffers.get(taskId);
    const lines = buf?.[phase] ?? [];
    // Grab last few non-empty output lines for context
    const tail = lines
      .map((l) => l.replace(/^\[.*?\]\s*/, '').trim())
      .filter(Boolean)
      .slice(-5);
    if (tail.length === 0) return baseError;
    return `${baseError}\n${tail.join('\n')}`;
  }

  private emitLifecycleEvent(
    taskId: string,
    phase: LifecyclePhase,
    status: LifecycleEvent['status'],
    extras?: Partial<LifecycleEvent>
  ): void {
    const evt: LifecycleEvent = {
      taskId,
      phase,
      status,
      timestamp: this.nowIso(),
      ...(extras || {}),
    };

    // Buffer log lines so they survive task switches in the renderer
    const line = formatLifecycleLogLine(phase, status, extras);
    if (line !== null) {
      this.appendLog(taskId, phase, line);
    }

    this.emit('event', evt);
  }

  private runFinite(
    taskId: string,
    taskPath: string,
    projectPath: string,
    phase: Extract<LifecyclePhase, 'setup' | 'teardown'>,
    taskName?: string
  ): Promise<LifecycleResult> {
    const script = lifecycleScriptsService.getScript(projectPath, phase);
    if (!script) return Promise.resolve({ ok: true, skipped: true });

    const state = this.ensureState(taskId);
    state[phase] = {
      status: 'running',
      startedAt: this.nowIso(),
      finishedAt: undefined,
      exitCode: null,
      error: null,
    };
    this.emitLifecycleEvent(taskId, phase, 'starting');

    return new Promise<LifecycleResult>((resolve) => {
      void (async () => {
        let settled = false;
        const finish = (result: LifecycleResult, nextState: LifecyclePhaseState): void => {
          if (settled) return;
          settled = true;
          state[phase] = nextState;
          resolve(result);
        };
        try {
          const env = await this.buildLifecycleEnv(taskId, taskPath, projectPath, taskName);
          const pty = this.createLifecyclePty(
            `lifecycle-${phase}-${taskId}`,
            script,
            taskPath,
            env
          );
          const untrackFinite = this.trackFinitePty(taskId, pty);
          pty.onData((line) => {
            if (!this.finitePtys.get(taskId)?.has(pty)) return;
            this.emitLifecycleEvent(taskId, phase, 'line', { line });
          });
          pty.onError((error) => {
            if (!this.finitePtys.get(taskId)?.has(pty)) return;
            untrackFinite();
            const message = error?.message || String(error);
            this.emitLifecycleEvent(taskId, phase, 'error', { error: message });
            const detail = this.buildErrorDetail(taskId, phase, message);
            finish(
              { ok: false, error: detail },
              {
                ...state[phase],
                status: 'failed',
                finishedAt: this.nowIso(),
                error: message,
              }
            );
          });
          pty.onExit((code) => {
            if (!this.finitePtys.get(taskId)?.has(pty)) return;
            untrackFinite();
            const ok = code === 0;
            this.emitLifecycleEvent(taskId, phase, ok ? 'done' : 'error', {
              exitCode: code,
              ...(ok ? {} : { error: `Exited with code ${String(code)}` }),
            });
            const errorMsg = `Exited with code ${String(code)}`;
            const detail = ok ? undefined : this.buildErrorDetail(taskId, phase, errorMsg);
            finish(ok ? { ok: true } : { ok: false, error: detail }, {
              ...state[phase],
              status: ok ? 'succeeded' : 'failed',
              finishedAt: this.nowIso(),
              exitCode: code,
              error: ok ? null : errorMsg,
            });
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.emitLifecycleEvent(taskId, phase, 'error', { error: message });
          finish(
            { ok: false, error: message },
            {
              ...state[phase],
              status: 'failed',
              finishedAt: this.nowIso(),
              error: message,
            }
          );
        }
      })();
    });
  }

  async runSetup(
    taskId: string,
    taskPath: string,
    projectPath: string,
    taskName?: string
  ): Promise<LifecycleResult> {
    const key = this.inflightKey(taskId, taskPath);
    if (this.setupInflight.has(key)) {
      return this.setupInflight.get(key)!;
    }
    const run = this.runFinite(taskId, taskPath, projectPath, 'setup', taskName).finally(() => {
      this.setupInflight.delete(key);
    });
    this.setupInflight.set(key, run);
    return run;
  }

  async startRun(
    taskId: string,
    taskPath: string,
    projectPath: string,
    taskName?: string
  ): Promise<LifecycleResult> {
    const inflight = this.runStartInflight.get(taskId);
    if (inflight) return inflight;

    const run = this.startRunInternal(taskId, taskPath, projectPath, taskName).finally(() => {
      if (this.runStartInflight.get(taskId) === run) {
        this.runStartInflight.delete(taskId);
      }
    });
    this.runStartInflight.set(taskId, run);
    return run;
  }

  private async startRunInternal(
    taskId: string,
    taskPath: string,
    projectPath: string,
    taskName?: string
  ): Promise<LifecycleResult> {
    const setupScript = lifecycleScriptsService.getScript(projectPath, 'setup');
    if (setupScript) {
      const setupStatus = this.ensureState(taskId).setup.status;
      if (setupStatus === 'idle' || setupStatus === 'failed') {
        log.info(`Auto-running setup before run (state was ${setupStatus})`, { taskId });
        const setupResult = await this.runSetup(taskId, taskPath, projectPath, taskName);
        if (!setupResult.ok) {
          return { ok: false, error: `Setup failed: ${setupResult.error}` };
        }
      } else if (setupStatus === 'running') {
        return { ok: false, error: 'Setup is still running' };
      }
    }

    const script = lifecycleScriptsService.getScript(projectPath, 'run');
    if (!script) return { ok: true, skipped: true };

    const existing = this.runPtys.get(taskId);
    if (existing && !this.stopIntents.has(taskId)) {
      return { ok: true, skipped: true };
    }

    // Clear any residual stop intent so the new process's exit is not misclassified.
    this.stopIntents.delete(taskId);

    const state = this.ensureState(taskId);
    state.run = {
      status: 'running',
      startedAt: this.nowIso(),
      finishedAt: undefined,
      exitCode: null,
      error: null,
      pid: null,
    };
    this.emitLifecycleEvent(taskId, 'run', 'starting');

    try {
      const env = await this.buildLifecycleEnv(taskId, taskPath, projectPath, taskName);
      const pty = this.createLifecyclePty(`lifecycle-run-${taskId}`, script, taskPath, env);
      this.runPtys.set(taskId, pty);
      state.run.pid = pty.pid;

      pty.onData((line) => {
        if (this.runPtys.get(taskId) !== pty) return;
        this.emitLifecycleEvent(taskId, 'run', 'line', { line });
      });
      pty.onError((error) => {
        if (this.runPtys.get(taskId) !== pty) return;
        this.runPtys.delete(taskId);
        this.stopIntents.delete(taskId);
        const message = error?.message || String(error);
        const cur = this.ensureState(taskId);
        cur.run = {
          ...cur.run,
          status: 'failed',
          finishedAt: this.nowIso(),
          error: message,
        };
        this.emitLifecycleEvent(taskId, 'run', 'error', { error: message });
      });
      pty.onExit((code) => {
        if (this.runPtys.get(taskId) !== pty) return;
        this.runPtys.delete(taskId);
        const wasStopped = this.stopIntents.has(taskId);
        this.stopIntents.delete(taskId);
        const cur = this.ensureState(taskId);
        cur.run = {
          ...cur.run,
          status: wasStopped ? 'idle' : code === 0 ? 'succeeded' : 'failed',
          finishedAt: this.nowIso(),
          exitCode: code,
          pid: null,
          error: wasStopped || code === 0 ? null : `Exited with code ${String(code)}`,
        };
        this.emitLifecycleEvent(taskId, 'run', 'exit', { exitCode: code });
      });

      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.run = {
        ...state.run,
        status: 'failed',
        finishedAt: this.nowIso(),
        error: message,
        pid: null,
      };
      this.emitLifecycleEvent(taskId, 'run', 'error', { error: message });
      return { ok: false, error: message };
    }
  }

  async stopRun(
    taskId: string,
    taskPath?: string,
    projectPath?: string,
    taskName?: string
  ): Promise<LifecycleResult> {
    const pty = this.runPtys.get(taskId);
    if (!pty) return { ok: true, skipped: true };

    this.stopIntents.add(taskId);

    // Run a configured stop script before killing the process.
    if (projectPath && taskPath) {
      const stopScript = lifecycleScriptsService.getScript(projectPath, 'stop');
      if (stopScript) {
        try {
          const env = await this.buildLifecycleEnv(taskId, taskPath, projectPath, taskName);
          const stopPty = this.createLifecyclePty(
            `lifecycle-stop-${taskId}`,
            stopScript,
            taskPath,
            env
          );
          const untrack = this.trackFinitePty(taskId, stopPty);
          stopPty.onData((line) => {
            if (!this.finitePtys.get(taskId)?.has(stopPty)) return;
            this.emitLifecycleEvent(taskId, 'run', 'line', { line });
          });
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
              log.warn('Stop script timed out, proceeding to kill', { taskId });
              try {
                stopPty.kill();
              } catch {}
              resolve();
            }, 30_000);
            stopPty.onExit(() => {
              clearTimeout(timer);
              resolve();
            });
            stopPty.onError(() => {
              clearTimeout(timer);
              resolve();
            });
          });
          untrack();
        } catch (error) {
          log.warn('Failed to run stop script, proceeding to kill', {
            taskId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // If the run process already exited (e.g. the stop script shut it down), we're done.
    const currentPty = this.runPtys.get(taskId);
    if (!currentPty || currentPty !== pty) {
      return { ok: true };
    }

    try {
      pty.kill();
      setTimeout(() => {
        const current = this.runPtys.get(taskId);
        if (!current || current !== pty) return;
        try {
          current.kill('SIGKILL');
        } catch {}
      }, 8_000);
      return { ok: true };
    } catch (error) {
      this.stopIntents.delete(taskId);
      const message = error instanceof Error ? error.message : String(error);
      const cur = this.ensureState(taskId);
      cur.run = {
        ...cur.run,
        status: 'failed',
        finishedAt: this.nowIso(),
        error: message,
      };
      log.warn('Failed to stop run process', { taskId, error: message });
      return { ok: false, error: message };
    }
  }

  async runTeardown(
    taskId: string,
    taskPath: string,
    projectPath: string,
    taskName?: string
  ): Promise<LifecycleResult> {
    const key = this.inflightKey(taskId, taskPath);
    if (this.teardownInflight.has(key)) {
      return this.teardownInflight.get(key)!;
    }
    const run = (async () => {
      // Serialize teardown behind setup for this task/worktree key.
      const setupRun = this.setupInflight.get(key);
      if (setupRun) {
        await setupRun.catch(() => {});
      }

      // Ensure a managed run process is stopped before teardown starts.
      const existingRun = this.runPtys.get(taskId);
      if (existingRun) {
        const waitForExit = this.waitForPtyExit(
          existingRun,
          () => this.runPtys.get(taskId) === existingRun,
          10_000,
          'Timed out waiting for run process to exit before teardown'
        );
        await this.stopRun(taskId, taskPath, projectPath, taskName);
        await waitForExit;
      }
      return this.runFinite(taskId, taskPath, projectPath, 'teardown', taskName);
    })().finally(() => {
      this.teardownInflight.delete(key);
    });
    this.teardownInflight.set(key, run);
    return run;
  }

  /**
   * Waits for any in-flight setup for the given taskId to complete.
   * Silently ignores setup failures — the caller proceeds regardless.
   * Used to ensure setup scripts finish before the agent PTY is spawned.
   */
  awaitSetup(taskId: string): Promise<void> {
    const prefix = `${taskId}::`;
    const promises: Promise<void>[] = [];
    for (const [key, promise] of this.setupInflight.entries()) {
      if (key.startsWith(prefix)) {
        promises.push(
          promise.then(
            () => {},
            () => {}
          )
        );
      }
    }
    return Promise.all(promises).then(() => {});
  }

  getState(taskId: string): TaskLifecycleState {
    return this.ensureState(taskId);
  }

  getLogs(taskId: string): LifecycleLogs {
    const buf = this.logBuffers.get(taskId);
    return buf
      ? { setup: [...buf.setup], run: [...buf.run], teardown: [...buf.teardown] }
      : { setup: [], run: [], teardown: [] };
  }

  clearTask(taskId: string): void {
    this.states.delete(taskId);
    this.logBuffers.delete(taskId);
    this.stopIntents.delete(taskId);
    this.runStartInflight.delete(taskId);

    const prefix = `${taskId}::`;
    for (const key of this.setupInflight.keys()) {
      if (key.startsWith(prefix)) {
        this.setupInflight.delete(key);
      }
    }
    for (const key of this.teardownInflight.keys()) {
      if (key.startsWith(prefix)) {
        this.teardownInflight.delete(key);
      }
    }

    const pty = this.runPtys.get(taskId);
    if (pty) {
      this.runPtys.delete(taskId);
      try {
        pty.kill();
      } catch {}
    }

    const finite = this.finitePtys.get(taskId);
    if (finite) {
      this.finitePtys.delete(taskId);
      for (const handle of finite) {
        try {
          handle.kill();
        } catch {}
      }
    }
  }

  shutdown(): void {
    const runPtys = [...this.runPtys.entries()];
    const finitePtys = [...this.finitePtys.values()];

    this.runPtys.clear();
    this.finitePtys.clear();

    for (const [taskId, pty] of runPtys) {
      try {
        this.stopIntents.add(taskId);
        pty.kill();
      } catch {}
    }
    for (const handles of finitePtys) {
      for (const handle of handles) {
        try {
          handle.kill();
        } catch {}
      }
    }
    this.runStartInflight.clear();
    this.setupInflight.clear();
    this.teardownInflight.clear();
  }

  onEvent(listener: (evt: LifecycleEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const taskLifecycleService = new TaskLifecycleService();
