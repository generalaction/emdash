import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { lifecycleScriptsService } from './LifecycleScriptsService';
import {
  type LifecycleEvent,
  type LifecyclePhase,
  type LifecyclePhaseState,
  type TaskLifecycleState,
} from '@shared/lifecycle';
import { getTaskEnvVars } from '@shared/task/envVars';
import { log } from '../lib/logger';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);

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

  private inflightKey(taskId: string, taskPath: string): string {
    return `${taskId}::${taskPath}`;
  }

  private killProcessTree(proc: ChildProcess, signal: NodeJS.Signals): void {
    const pid = proc.pid;
    if (!pid) return;

    if (process.platform === 'win32') {
      const args = ['/PID', String(pid), '/T'];
      if (signal === 'SIGKILL') {
        args.push('/F');
      }
      const killer = spawn('taskkill', args, { stdio: 'ignore' });
      killer.unref();
      return;
    }

    try {
      // Detached shell commands run as their own process group.
      process.kill(-pid, signal);
    } catch {
      proc.kill(signal);
    }
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
    projectPath: string
  ): Promise<NodeJS.ProcessEnv> {
    const defaultBranch = await this.resolveDefaultBranch(projectPath);
    const taskName = path.basename(taskPath) || taskId;
    const taskEnv = getTaskEnvVars({
      taskId,
      taskName,
      taskPath,
      projectPath,
      defaultBranch,
      portSeed: taskPath || taskId,
    });
    return { ...process.env, ...taskEnv };
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

    return (async () => {
      const env = await this.buildLifecycleEnv(taskId, taskPath, projectPath);
      return await new Promise<LifecycleResult>((resolve) => {
        try {
          const child = spawn(script, {
            cwd: taskPath,
            shell: true,
            env,
            detached: true,
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
    })();
  }

  async runSetup(taskId: string, taskPath: string, projectPath: string): Promise<LifecycleResult> {
    const key = this.inflightKey(taskId, taskPath);
    if (this.setupInflight.has(key)) {
      return this.setupInflight.get(key)!;
    }
    const run = this.runFinite(taskId, taskPath, projectPath, 'setup').finally(() => {
      this.setupInflight.delete(key);
    });
    this.setupInflight.set(key, run);
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
      const env = await this.buildLifecycleEnv(taskId, taskPath, projectPath);
      const child = spawn(script, {
        cwd: taskPath,
        shell: true,
        env,
        detached: true,
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
        if (this.runProcesses.get(taskId) !== child) return;
        this.runProcesses.delete(taskId);
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
      child.on('exit', (code) => {
        if (this.runProcesses.get(taskId) !== child) return;
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
      this.killProcessTree(proc, 'SIGTERM');
      setTimeout(() => {
        const current = this.runProcesses.get(taskId);
        if (!current || current !== proc) return;
        this.killProcessTree(proc, 'SIGKILL');
      }, 8_000);
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
    const key = this.inflightKey(taskId, taskPath);
    if (this.teardownInflight.has(key)) {
      return this.teardownInflight.get(key)!;
    }
    const run = (async () => {
      // Ensure a managed run process is stopped before teardown starts.
      const existingRun = this.runProcesses.get(taskId);
      if (existingRun) {
        this.stopRun(taskId);
        await new Promise<void>((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          const timer = setTimeout(() => {
            log.warn('Timed out waiting for run process to exit before teardown', { taskId });
            finish();
          }, 10_000);
          existingRun.once('exit', () => {
            clearTimeout(timer);
            finish();
          });
        });
      }
      return this.runFinite(taskId, taskPath, projectPath, 'teardown');
    })().finally(() => {
      this.teardownInflight.delete(key);
    });
    this.teardownInflight.set(key, run);
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
