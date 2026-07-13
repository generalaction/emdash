import { execFile, type ExecFileException } from 'node:child_process';
import { err, ok, type Result } from '@emdash/shared';
import type { AgentConfigInstallCommandRunner } from '@runtimes/agent-config/node/runtime/types';
import type { InstallCommandError } from '@services/host-dependencies/node';

const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const MAX_INSTALL_OUTPUT_BUFFER = 10 * 1024 * 1024;

export function createExecInstallCommandRunner(options: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: string;
}): AgentConfigInstallCommandRunner {
  return (command, ctx = {}) =>
    new Promise<Result<void, InstallCommandError>>((resolve) => {
      execFile(
        options.shell,
        ['-lc', command],
        {
          cwd: options.cwd,
          env: options.env,
          maxBuffer: MAX_INSTALL_OUTPUT_BUFFER,
          signal: ctx.signal,
        },
        (error, stdout, stderr) => {
          if (!error) {
            resolve(ok());
            return;
          }
          resolve(err(classifyInstallCommandError(error, `${stdout}${stderr}`)));
        }
      );
    });
}

function classifyInstallCommandError(
  error: ExecFileException,
  output: string
): InstallCommandError {
  return classifyInstallCommandFailure({
    exitCode: typeof error.code === 'number' ? error.code : undefined,
    output: output || error.message,
  });
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
