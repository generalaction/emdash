import os from 'node:os';
import type { InstallCommandError } from '@shared/dependencies';
import { err, ok, type Result } from '@shared/result';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import type { Pty } from '@main/core/pty/pty';
import { logLocalPtySpawnWarnings, resolveLocalPtySpawn } from '@main/core/pty/pty-spawn-platform';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import { buildRemoteShellCommand } from '@main/core/ssh/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { log } from '@main/lib/logger';
import { ensureUserBinDirsInPath } from '@main/utils/userEnv';

export type InstallCommandRunner<TData = void, TError = InstallCommandError> = (
  command: string
) => Promise<Result<TData, TError>>;

const ANSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export function classifyInstallCommandFailure({
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

function waitForInstallPty(pty: Pty): Promise<Result<void, InstallCommandError>> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    pty.onData((chunk: string) => chunks.push(chunk));
    pty.onExit(({ exitCode }) => {
      if (exitCode === 0) {
        log.info(`[DependencyManager] Install succeeded`);
        resolve(ok());
        return;
      }

      const output = chunks.join('').trim();
      log.error(`[DependencyManager] Install failed`, { exitCode, output });
      resolve(err(classifyInstallCommandFailure({ exitCode, output })));
    });
  });
}

export function runLocalInstallCommand(
  command: string
): Promise<Result<void, InstallCommandError>> {
  const installId = `install:${crypto.randomUUID()}`;
  const resolved = resolveLocalPtySpawn({
    platform: process.platform,
    env: process.env,
    intent: {
      kind: 'run-command',
      cwd: os.homedir(),
      command: { kind: 'shell-line', commandLine: command },
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

export function createSshInstallCommandRunner(proxy: SshClientProxy): InstallCommandRunner {
  return async (command: string) => {
    const profile = await proxy.getRemoteShellProfile();
    const result = await openSsh2Pty(proxy.client, {
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
