import os from 'node:os';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '@main/core/pty/pty-spawn-platform';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import { buildRemoteShellCommand } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import { log } from '@main/lib/logger';
import { ensureUserBinDirsInPath } from '@main/utils/userEnv';
import type { InstallCommandError } from '@shared/core/dependencies';
import { err, ok, type Result } from '@shared/lib/result';

export type InstallCommandRunner<TData = void, TError = InstallCommandError> = (
  command: string
) => Promise<Result<TData, TError>>;

type ShellProfileResolver = () => Promise<ResolvedShellProfile>;

const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
export const INSTALL_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
export const INSTALL_COMMAND_OUTPUT_LIMIT = 8_000;

function appendBoundedOutput(output: string, chunk: string): string {
  const next = output + chunk;
  if (next.length <= INSTALL_COMMAND_OUTPUT_LIMIT) return next;
  return next.slice(next.length - INSTALL_COMMAND_OUTPUT_LIMIT);
}

function cleanInstallOutput(output: string): string {
  return output.replace(ANSI_RE, '').trim();
}

export function classifyInstallCommandFailure({
  exitCode,
  output,
}: {
  exitCode: number | undefined;
  output: string;
}): InstallCommandError {
  const cleanOutput = cleanInstallOutput(output);
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

function waitForInstallPty(pty: Pty): Promise<Result<void, InstallCommandError>> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      const cleanOutput = cleanInstallOutput(output);
      log.error(`[DependencyManager] Install timed out`, {
        timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
        output: cleanOutput,
      });
      try {
        pty.kill();
      } catch (error) {
        log.warn(`[DependencyManager] Failed to kill timed out install PTY`, { error });
      }
      resolve(
        err({
          type: 'install-timed-out',
          message: 'Install command timed out.',
          output: cleanOutput,
          timeoutMs: INSTALL_COMMAND_TIMEOUT_MS,
        })
      );
    }, INSTALL_COMMAND_TIMEOUT_MS);

    pty.onData((chunk: string) => {
      output = appendBoundedOutput(output, chunk);
    });
    pty.onExit(({ exitCode }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (exitCode === 0) {
        log.info(`[DependencyManager] Install succeeded`);
        resolve(ok());
        return;
      }

      const cleanOutput = cleanInstallOutput(output);
      log.error(`[DependencyManager] Install failed`, { exitCode, output: cleanOutput });
      resolve(err(classifyInstallCommandFailure({ exitCode, output: cleanOutput })));
    });
  });
}

export async function runLocalInstallCommand(
  command: string,
  shellProfile: ResolvedShellProfile
): Promise<Result<void, InstallCommandError>> {
  const installId = `install:${crypto.randomUUID()}`;
  const resolved = resolveLocalPtySpawn({
    platform: process.platform,
    env: process.env,
    intent: {
      kind: 'run-command',
      cwd: os.homedir(),
      command: { kind: 'shell-line', commandLine: command },
      shellProfile,
    },
  });
  logLocalPtySpawnWarnings('DependencyManager', resolved.warnings, { installId });

  let pty: Pty;
  try {
    pty = spawnLocalPty({
      id: installId,
      command: resolved.command,
      args: resolved.args,
      cwd: resolved.cwd,
      env: process.env as Record<string, string>,
      cols: 80,
      rows: 24,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return Promise.resolve(err({ type: 'pty-open-failed', message }));
  }

  return waitForInstallPty(pty).then((result) => {
    if (result.success) {
      ensureUserBinDirsInPath();
    }
    return result;
  });
}

export function createLocalInstallCommandRunner(
  resolveShellProfile: ShellProfileResolver
): InstallCommandRunner {
  return async (command) => {
    const shellProfile = await resolveShellProfile();
    return await runLocalInstallCommand(command, shellProfile);
  };
}

export function createSshInstallCommandRunner(proxy: SshClientProxy): InstallCommandRunner {
  return async (command: string) => {
    const profile = await proxy.getRemoteShellProfile();
    const result = await openSsh2Pty(proxy, {
      id: `install:${crypto.randomUUID()}`,
      command: buildRemoteShellCommand(profile, command),
      cols: 80,
      rows: 24,
    });

    if (!result.success) {
      return err({ type: 'pty-open-failed', message: result.error.message });
    }

    return waitForInstallPty(result.data);
  };
}
