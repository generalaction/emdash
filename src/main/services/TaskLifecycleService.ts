import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { lifecycleScriptsService } from './LifecycleScriptsService';
import {
  type LifecycleEvent,
  type LifecyclePhase,
  type LifecyclePhaseState,
  type TaskLifecycleState,
} from '@shared/lifecycle';
import { log } from '../lib/logger';

type LifecycleResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

class TaskLifecycleService extends EventEmitter {
  private states = new Map<string, TaskLifecycleState>();
  private runProcesses = new Map<string, ChildProcess>();
  private setupInflight = new Map<string, Promise<LifecycleResult>>();
  private teardownInflight = new Map<string, Promise<LifecycleResult>>();
  private stopIntents = new Set<string>();

  private nowIso(): string {
    return new Date().toISOString();
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
    this.emit('event', evt);
  }

  private runFinite(
    taskId: string,
    taskPath: string,
    projectPath: string,
    phase: Extract<LifecyclePhase, 'setup' | 'teardown'>
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
      try {
        const child = spawn(script, {
          cwd: taskPath,
          shell: true,
          env: { ...process.env },
        });
        const onData = (buf: Buffer) => {
          const line = buf.toString();
          this.emitLifecycleEvent(taskId, phase, 'line', { line });
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', onData);
        child.on('error', (error) => {
          const message = error?.message || String(error);
          state[phase] = {
            ...state[phase],
            status: 'failed',
            finishedAt: this.nowIso(),
            error: message,
          };
          this.emitLifecycleEvent(taskId, phase, 'error', { error: message });
          resolve({ ok: false, error: message });
        });
        child.on('exit', (code) => {
          const ok = code === 0;
          state[phase] = {
            ...state[phase],
            status: ok ? 'succeeded' : 'failed',
            finishedAt: this.nowIso(),
            exitCode: code,
            error: ok ? null : `Exited with code ${String(code)}`,
          };
          this.emitLifecycleEvent(taskId, phase, ok ? 'done' : 'error', {
            exitCode: code,
            ...(ok ? {} : { error: `Exited with code ${String(code)}` }),
          });
          resolve(ok ? { ok: true } : { ok: false, error: `Exited with code ${String(code)}` });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state[phase] = {
          ...state[phase],
          status: 'failed',
          finishedAt: this.nowIso(),
          error: message,
        };
        this.emitLifecycleEvent(taskId, phase, 'error', { error: message });
        resolve({ ok: false, error: message });
      }
    });
  }

  async runSetup(taskId: string, taskPath: string, projectPath: string): Promise<LifecycleResult> {
    if (this.setupInflight.has(taskId)) {
      return this.setupInflight.get(taskId)!;
    }
    const run = this.runFinite(taskId, taskPath, projectPath, 'setup').finally(() => {
      this.setupInflight.delete(taskId);
    });
    this.setupInflight.set(taskId, run);
    return run;
  }

  async startRun(taskId: string, taskPath: string, projectPath: string): Promise<LifecycleResult> {
    const script = lifecycleScriptsService.getScript(projectPath, 'run');
    if (!script) return { ok: true, skipped: true };

    const existing = this.runProcesses.get(taskId);
    if (existing && existing.exitCode === null && !existing.killed) {
      return { ok: true, skipped: true };
    }

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
      const child = spawn(script, {
        cwd: taskPath,
        shell: true,
        env: { ...process.env },
      });
      this.runProcesses.set(taskId, child);
      state.run.pid = child.pid ?? null;

      const onData = (buf: Buffer) => {
        const line = buf.toString();
        this.emitLifecycleEvent(taskId, 'run', 'line', { line });
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', (error) => {
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
      child.on('exit', (code) => {
        this.runProcesses.delete(taskId);
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

  stopRun(taskId: string): LifecycleResult {
    const proc = this.runProcesses.get(taskId);
    if (!proc) return { ok: true, skipped: true };

    this.stopIntents.add(taskId);
    try {
      proc.kill();
      return { ok: true };
    } catch (error) {
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
    projectPath: string
  ): Promise<LifecycleResult> {
    if (this.teardownInflight.has(taskId)) {
      return this.teardownInflight.get(taskId)!;
    }
    // Ensure a managed run process is stopped before teardown starts.
    this.stopRun(taskId);
    const run = this.runFinite(taskId, taskPath, projectPath, 'teardown').finally(() => {
      this.teardownInflight.delete(taskId);
    });
    this.teardownInflight.set(taskId, run);
    return run;
  }

  getState(taskId: string): TaskLifecycleState {
    return this.ensureState(taskId);
  }

  onEvent(listener: (evt: LifecycleEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const taskLifecycleService = new TaskLifecycleService();
