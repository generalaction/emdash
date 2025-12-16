import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { log } from '../lib/logger';

export type SetupStepsEvent = {
  type: 'setupSteps';
  workspaceId: string;
  status: 'starting' | 'line' | 'done' | 'error' | 'cancelled';
  stepIndex?: number;
  step?: string;
  line?: string;
};

type ActiveRun = {
  child: ChildProcessWithoutNullStreams | null;
  cancelled: boolean;
};

function getUserShell(): { shell: string; argsForCommand: (command: string) => string[] } {
  if (process.platform === 'win32') {
    // Prefer PowerShell when available; fall back to cmd.
    const shell = process.env.ComSpec || 'powershell.exe';
    const lower = shell.toLowerCase();
    if (lower.includes('powershell')) {
      return {
        shell,
        argsForCommand: (command: string) => [
          '-NoLogo',
          '-NoProfile',
          '-Command',
          command,
        ],
      };
    }
    return {
      shell,
      argsForCommand: (command: string) => ['/d', '/s', '/c', command],
    };
  }

  const shell = process.env.SHELL || '/bin/bash';
  const base = path.basename(shell).toLowerCase();
  // Use login + interactive where supported so user PATH (poetry, nvm, etc) is available.
  if (base === 'zsh' || base === 'bash') {
    return { shell, argsForCommand: (command: string) => ['-lic', command] };
  }
  if (base === 'fish') {
    // fish: -l login, -c command
    return { shell, argsForCommand: (command: string) => ['-lc', command] };
  }
  // sh and other shells
  return { shell, argsForCommand: (command: string) => ['-lc', command] };
}

/**
 * Runs setup steps sequentially in the worktree using the user's shell, streaming logs.
 * This is intentionally blocking (awaits completion) so "Run" can reliably start scripts after deps exist.
 */
class SetupStepsService extends EventEmitter {
  private readonly active = new Map<string, ActiveRun>();

  async run(args: {
    workspaceId: string;
    worktreePath: string;
    steps: string[];
  }): Promise<{ ok: boolean; error?: string }> {
    const { workspaceId, worktreePath, steps } = args;
    const cwd = path.resolve(worktreePath);

    // Cancel any previous run (best effort)
    this.cancel(workspaceId);

    const rec: ActiveRun = { child: null, cancelled: false };
    this.active.set(workspaceId, rec);

    const { shell, argsForCommand } = getUserShell();

    const emit = (event: Omit<SetupStepsEvent, 'type' | 'workspaceId'>) => {
      this.emit(
        'event',
        { type: 'setupSteps', workspaceId, ...event } satisfies SetupStepsEvent
      );
    };

    try {
      if (!steps.length) {
        emit({ status: 'done' });
        return { ok: true };
      }

      for (let i = 0; i < steps.length; i++) {
        if (rec.cancelled) {
          emit({ status: 'cancelled', stepIndex: i });
          return { ok: false, error: 'Setup cancelled.' };
        }

        const step = steps[i]!;
        emit({ status: 'starting', stepIndex: i, step });

        const child = spawn(shell, argsForCommand(step), {
          cwd,
          shell: false,
          env: { ...process.env },
          windowsHide: true,
        });
        rec.child = child;

        const onData = (buf: Buffer) => {
          emit({
            status: 'line',
            stepIndex: i,
            step,
            line: buf.toString(),
          });
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);

        const exitCode = await new Promise<number>((resolve, reject) => {
          child.on('error', reject);
          child.on('exit', (code) => resolve(typeof code === 'number' ? code : 1));
        });

        rec.child = null;

        if (rec.cancelled) {
          emit({ status: 'cancelled', stepIndex: i, step });
          return { ok: false, error: 'Setup cancelled.' };
        }

        if (exitCode !== 0) {
          const error = `Setup step ${i + 1}/${steps.length} failed (exit ${exitCode}).`;
          emit({ status: 'error', stepIndex: i, step, line: error });
          return { ok: false, error };
        }
      }

      emit({ status: 'done' });
      return { ok: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log.error('setupSteps failed', { workspaceId, cwd, error });
      emit({ status: 'error', line: msg });
      return { ok: false, error: msg };
    } finally {
      this.active.delete(workspaceId);
    }
  }

  cancel(workspaceId: string): { ok: boolean } {
    const rec = this.active.get(workspaceId);
    if (!rec) return { ok: true };
    rec.cancelled = true;
    try {
      rec.child?.kill();
    } catch {}
    rec.child = null;
    return { ok: true };
  }

  onEvent(listener: (event: SetupStepsEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const setupStepsService = new SetupStepsService();


