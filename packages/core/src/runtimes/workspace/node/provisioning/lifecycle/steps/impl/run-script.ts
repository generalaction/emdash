import { spawn } from 'node:child_process';
import { runScriptStep } from '@runtimes/workspace/api/provisioning/catalog';
import {
  implement,
  stepErr,
  stepOk,
  type StepOutcome,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/implement';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export const runScriptImpl = implement(runScriptStep, async (args, ctx) => {
  const cwd = args.cwd === 'repo' ? ctx.repoPath : (ctx.resolvedWorktreePath ?? ctx.repoPath);
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const shell = process.env.SHELL ?? '/bin/sh';
  const emitOutput = ctx.emitOutput;

  return await new Promise((resolve) => {
    let settled = false;
    const child = spawn(shell, ['-lc', args.command], {
      cwd,
      env: {
        ...process.env,
        CI: process.env.CI ?? '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (result: StepOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(
        stepErr('permanent', {
          type: 'script-timeout',
          message: `Script "${args.id}" timed out after ${timeoutMs}ms`,
        })
      );
    }, timeoutMs);

    const onAbort = () => {
      child.kill('SIGTERM');
      finish(
        stepErr('permanent', {
          type: 'cancelled',
          message: `Script "${args.id}" was cancelled`,
        })
      );
    };

    ctx.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => emitOutput?.(chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => emitOutput?.(chunk.toString()));
    child.on('error', (error) => {
      finish(
        stepErr('permanent', {
          type: 'script-failed',
          message: error.message,
        })
      );
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        finish(stepOk());
        return;
      }
      finish(
        stepErr('permanent', {
          type: 'script-failed',
          message: signal
            ? `Script "${args.id}" exited after signal ${signal}`
            : `Script "${args.id}" exited with code ${code ?? 'unknown'}`,
        })
      );
    });
  });
});
