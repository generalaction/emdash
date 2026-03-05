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
import { killPty } from './ptyManager';
import { startShellSession } from './ptyIpc';

const execFileAsync = promisify(execFile);

type LifecycleResult = {
  ok: boolean;
  skipped?: boolean;
  error?: string;
};

class TaskLifecycleService extends EventEmitter {
  private states = new Map<string, TaskLifecycleState>();
  private runProcesses = new Map<string, ChildProcess>();
  private runPtyIds = new Map<string, string>();
  private finiteProcesses = new Map<string, Set<ChildProcess>>();
  /** Maps taskId → Set of lifecycle PTY IDs (setup/teardown) in flight */
  private finiteSessionPtyIds = new Map<string, Set<string>>();
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

  private trackFiniteProcess(taskId: string, proc: ChildProcess): () => void {
    const set = this.finiteProcesses.get(taskId) ?? new Set<ChildProcess>();
    set.add(proc);
    this.finiteProcesses.set(taskId, set);
    return () => {
      const current = this.finiteProcesses.get(taskId);
      if (!current) return;
      current.delete(proc);
      if (current.size === 0) {
        this.finiteProcesses.delete(taskId);
      }
    };
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
          const { ptyId } = await startShellSession({
            taskId,
            title: phase === 'setup' ? 'Setup' : 'Teardown',
            cwd: taskPath,
            command: script,
            env,
            onExit: (exitCode) => {
              // Remove from finite tracking
              const finiteSet = this.finiteSessionPtyIds.get(taskId);
              if (finiteSet) {
                finiteSet.delete(ptyId);
                if (finiteSet.size === 0) this.finiteSessionPtyIds.delete(taskId);
              }
              const ok = exitCode === 0;
              this.emitLifecycleEvent(taskId, phase, ok ? 'done' : 'error', {
                exitCode,
                ...(ok ? {} : { error: `Exited with code ${String(exitCode)}` }),
              });
              finish(
                ok ? { ok: true } : { ok: false, error: `Exited with code ${String(exitCode)}` },
                {
                  ...state[phase],
                  status: ok ? 'succeeded' : 'failed',
                  finishedAt: this.nowIso(),
                  exitCode,
                  error: ok ? null : `Exited with code ${String(exitCode)}`,
                }
              );
            },
          });
          // Track this finite PTY so clearTask can kill it
          const finiteSet = this.finiteSessionPtyIds.get(taskId) ?? new Set<string>();
          finiteSet.add(ptyId);
          this.finiteSessionPtyIds.set(taskId, finiteSet);
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
      if (setupStatus === 'running') {
        return { ok: false, error: 'Setup is still running' };
      }
      if (setupStatus === 'failed') {
        return { ok: false, error: 'Setup failed. Fix setup before starting run' };
      }
      if (setupStatus !== 'succeeded') {
        return { ok: false, error: 'Setup has not completed yet' };
      }
    }

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
      const env = await this.buildLifecycleEnv(taskId, taskPath, projectPath, taskName);
      const { ptyId } = await startShellSession({
        taskId,
        title: 'Dev Server',
        cwd: taskPath,
        command: script,
        env,
        onExit: (exitCode) => {
          if (this.runPtyIds.get(taskId) !== ptyId) return;
          this.runPtyIds.delete(taskId);
          const wasStopped = this.stopIntents.has(taskId);
          this.stopIntents.delete(taskId);
          const cur = this.ensureState(taskId);
          cur.run = {
            ...cur.run,
            status: wasStopped ? 'idle' : exitCode === 0 ? 'succeeded' : 'failed',
            finishedAt: this.nowIso(),
            exitCode,
            pid: null,
            error: wasStopped || exitCode === 0 ? null : `Exited with code ${String(exitCode)}`,
          };
          this.emitLifecycleEvent(taskId, 'run', 'exit', { exitCode });
        },
      });
      this.runPtyIds.set(taskId, ptyId);
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
    const ptyId = this.runPtyIds.get(taskId);
    const legacyProc = this.runProcesses.get(taskId);
    if (!ptyId && !legacyProc) return { ok: true, skipped: true };

    this.stopIntents.add(taskId);
    try {
      if (ptyId) {
        killPty(ptyId);
      } else if (legacyProc) {
        this.killProcessTree(legacyProc, 'SIGTERM');
        setTimeout(() => {
          if (this.runProcesses.get(taskId) !== legacyProc) return;
          this.killProcessTree(legacyProc, 'SIGKILL');
        }, 8_000);
      }
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

      // Ensure a managed run process/PTY is stopped before teardown starts.
      const hasRun = this.runPtyIds.has(taskId) || this.runProcesses.has(taskId);
      if (hasRun) {
        this.stopRun(taskId);
        // Wait for the run PTY (or legacy process) to exit, up to 10s.
        await new Promise<void>((resolve) => {
          const startMs = Date.now();
          const poll = () => {
            if (!this.runPtyIds.has(taskId) && !this.runProcesses.has(taskId)) {
              resolve();
              return;
            }
            if (Date.now() - startMs >= 10_000) {
              log.warn('Timed out waiting for run PTY to exit before teardown', { taskId });
              resolve();
              return;
            }
            setTimeout(poll, 200);
          };
          poll();
        });
      }
      return this.runFinite(taskId, taskPath, projectPath, 'teardown', taskName);
    })().finally(() => {
      this.teardownInflight.delete(key);
    });
    this.teardownInflight.set(key, run);
    return run;
  }

  getState(taskId: string): TaskLifecycleState {
    return this.ensureState(taskId);
  }

  clearTask(taskId: string): void {
    this.states.delete(taskId);
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

    const ptyId = this.runPtyIds.get(taskId);
    if (ptyId) {
      try {
        killPty(ptyId);
      } catch {}
      this.runPtyIds.delete(taskId);
    }

    const proc = this.runProcesses.get(taskId);
    if (proc) {
      try {
        this.killProcessTree(proc, 'SIGTERM');
      } catch {}
      this.runProcesses.delete(taskId);
    }

    const finitePtys = this.finiteSessionPtyIds.get(taskId);
    if (finitePtys) {
      for (const ptyId of finitePtys) {
        try {
          killPty(ptyId);
        } catch {}
      }
      this.finiteSessionPtyIds.delete(taskId);
    }

    const finite = this.finiteProcesses.get(taskId);
    if (finite) {
      for (const child of finite) {
        try {
          this.killProcessTree(child, 'SIGTERM');
        } catch {}
      }
      this.finiteProcesses.delete(taskId);
    }
  }

  shutdown(): void {
    for (const [taskId, ptyId] of this.runPtyIds.entries()) {
      try {
        this.stopIntents.add(taskId);
        killPty(ptyId);
      } catch {}
    }
    for (const [taskId, proc] of this.runProcesses.entries()) {
      try {
        this.stopIntents.add(taskId);
        this.killProcessTree(proc, 'SIGTERM');
      } catch {}
    }
    for (const procs of this.finiteProcesses.values()) {
      for (const proc of procs) {
        try {
          this.killProcessTree(proc, 'SIGTERM');
        } catch {}
      }
    }
    this.runPtyIds.clear();
    this.runProcesses.clear();
    this.finiteSessionPtyIds.clear();
    this.finiteProcesses.clear();
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
