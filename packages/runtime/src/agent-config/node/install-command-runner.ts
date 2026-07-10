import type { InstallCommandError } from '@emdash/core/deps/runtime';
import type { NodePtySpawner } from '@emdash/core/pty/node';
import { err, ok, type Result } from '@emdash/shared';
import type { AgentConfigInstallCommandRunner } from '../runtime/types';

const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export function createPtyInstallCommandRunner(options: {
  spawner: NodePtySpawner;
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: string;
}): AgentConfigInstallCommandRunner {
  return async (command, ctx = {}) => {
    let proc;
    try {
      proc = await options.spawner.spawn({
        command: options.shell,
        args: ['-lc', command],
        cwd: options.cwd,
        env: Object.fromEntries(
          Object.entries(options.env).filter(
            (entry): entry is [string, string] => entry[1] !== undefined
          )
        ),
        cols: 80,
        rows: 24,
      });
    } catch (error) {
      return err({ type: 'pty-open-failed', message: errorMessage(error) });
    }

    return await new Promise<Result<void, InstallCommandError>>((resolve) => {
      const chunks: string[] = [];
      const abort = () => proc.kill();
      ctx.signal?.addEventListener('abort', abort, { once: true });
      proc.onData((chunk) => {
        chunks.push(chunk);
        ctx.onOutput?.(chunk);
      });
      proc.onExit(({ exitCode }) => {
        ctx.signal?.removeEventListener('abort', abort);
        if (exitCode === 0) {
          resolve(ok());
          return;
        }
        resolve(
          err(
            classifyInstallCommandFailure({
              exitCode: exitCode ?? undefined,
              output: chunks.join(''),
            })
          )
        );
      });
    });
  };
}

function classifyInstallCommandFailure({
  exitCode,
  output,
}: {
  exitCode: number | undefined;
  output: string;
}): InstallCommandError {
  const cleanOutput = output.replace(ANSI_RE, '').trim();
  if (/\bEACCES\b|permission denied|not have the permissions/i.test(cleanOutput)) {
    return {
      type: 'permission-denied',
      exitCode,
      output: cleanOutput,
      message: 'User does not have sufficient permissions.',
    };
  }

  return {
    type: 'command-failed',
    exitCode,
    output: cleanOutput,
    message: 'Install command failed.',
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
