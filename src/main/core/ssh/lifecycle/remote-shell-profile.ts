import type { ClientCallback, ClientChannel } from 'ssh2';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { isValidEnvVarName, quoteShellArg } from '@main/utils/shellEscape';
import { parseRemoteEnvOutput, SHELL_ENV_CAPTURE_GUARD } from '@main/utils/userEnv';
import {
  isCshShell,
  terminalCommandArgs,
  terminalEnvCaptureArgs,
  terminalShellBasename,
} from '@shared/terminal-settings';

export type RemoteShellProfile = {
  shell: string;
  env: Record<string, string>;
};

export const DEFAULT_REMOTE_SHELL = '/bin/sh';

export const FALLBACK_REMOTE_SHELL_PROFILE: RemoteShellProfile = {
  shell: DEFAULT_REMOTE_SHELL,
  env: {},
};

const CAPTURE_TIMEOUT_MS = 5_000;
const SHELL_TIMEOUT_MS = 3_000;

const LOGIN_SHELLS = new Set(['bash', 'csh', 'ksh', 'tcsh', 'zsh']);
const BASIC_POSIX_SHELLS = new Set(['dash', 'sh']);
const SUPPORTED_REMOTE_SHELLS = new Set([...BASIC_POSIX_SHELLS, ...LOGIN_SHELLS]);
const VOLATILE_ENV_KEYS = new Set(['_', 'PWD', 'OLDPWD', 'SHLVL', 'COLUMNS', 'LINES']);

type RawExecResult = {
  stdout: string;
  stderr: string;
};

type RemoteShellExecClient = {
  exec(command: string, callback: ClientCallback): void;
};

export function normalizeRemoteShell(raw: string | undefined | null): string {
  const shell = raw?.trim();
  if (
    !shell ||
    !shell.startsWith('/') ||
    !SUPPORTED_REMOTE_SHELLS.has(terminalShellBasename(shell))
  ) {
    return DEFAULT_REMOTE_SHELL;
  }
  return shell;
}

function buildRemoteShellEnvPrefix(shell: string, env: Record<string, string>): string {
  const exports = Object.entries(env)
    .filter(([key]) => shouldForwardEnvKey(key))
    .map(([key, value]) =>
      isCshShell(shell)
        ? `setenv ${key} ${quoteCshArg(value)}`
        : `export ${key}=${quoteShellArg(value)}`
    );

  return exports.length > 0 ? `${exports.join('; ')}; ` : '';
}

function quoteCshArg(value: string): string {
  return quoteShellArg(value).replace(/!/g, '\\!');
}

function buildRemoteShellProcessEnvPrefix(env: Record<string, string>): string {
  const assignments = Object.entries(env)
    .filter(([key]) => shouldForwardEnvKey(key))
    .map(([key, value]) => quoteShellArg(`${key}=${value}`));

  return assignments.length > 0 ? `env ${assignments.join(' ')} ` : '';
}

export function buildRemoteShellCommand(
  profile: RemoteShellProfile,
  command: string,
  env: Record<string, string> = {}
): string {
  const shell = normalizeRemoteShell(profile.shell);
  const prefix = `${buildRemoteShellEnvPrefix(shell, profile.env)}${buildRemoteShellEnvPrefix(
    shell,
    env
  )}`;
  return `${quoteShellArg(shell)} ${terminalCommandArgs(shell).join(' ')} ${quoteShellArg(
    `${prefix}${command}`
  )}`;
}

export function buildRemoteShellCommandWithPathLookup(
  profile: RemoteShellProfile,
  shellName: string,
  command: string,
  env: Record<string, string> = {}
): string {
  const selectedShellEnv = { ...env, SHELL: shellName };
  const prefix = `${buildRemoteShellEnvPrefix(
    shellName,
    withoutShellEnv(profile.env)
  )}${buildRemoteShellEnvPrefix(shellName, selectedShellEnv)}`;
  const remotePath = env.PATH ?? profile.env.PATH;
  const pathArg = remotePath ? `${quoteShellArg(`PATH=${remotePath}`)} ` : '';
  return `${quoteShellArg('/usr/bin/env')} ${pathArg}${quoteShellArg(
    shellName
  )} ${terminalCommandArgs(shellName).join(' ')} ${quoteShellArg(`${prefix}${command}`)}`;
}

export function includeRemoteUserBinDirs(env: Record<string, string>): Record<string, string> {
  const home = env.HOME?.replace(/\/+$/, '');
  if (!home) return env;

  const userBin = `${home}/.local/bin`;
  const pathEntries = (env.PATH ?? '').split(':').filter(Boolean);
  if (pathEntries.includes(userBin)) return env;

  return {
    ...env,
    PATH: [userBin, ...pathEntries].join(':'),
  };
}

export async function resolveRemoteHome(ctx: IExecutionContext): Promise<string> {
  const { stdout } = await ctx.exec('sh', ['-c', 'printf %s "$HOME"']);
  const home = stdout.trim();
  if (!home) {
    throw new Error('Remote home directory is empty');
  }
  return home;
}

export async function captureRemoteShellProfile(
  client: RemoteShellExecClient
): Promise<RemoteShellProfile> {
  const shell = await resolveRemoteShell(client);
  const env = await captureRemoteEnv(client, shell);
  return { shell, env };
}

async function resolveRemoteShell(client: RemoteShellExecClient): Promise<string> {
  try {
    const { stdout } = await execRaw(client, 'printf %s "$SHELL"', SHELL_TIMEOUT_MS);
    return normalizeRemoteShell(stdout);
  } catch {
    return DEFAULT_REMOTE_SHELL;
  }
}

async function captureRemoteEnv(
  client: RemoteShellExecClient,
  shell: string
): Promise<Record<string, string>> {
  try {
    const guard = buildRemoteShellProcessEnvPrefix(SHELL_ENV_CAPTURE_GUARD);
    const envCaptureArgs = terminalEnvCaptureArgs(shell) ?? ['-ic'];
    const capture = `${guard}${quoteShellArg(shell)} ${envCaptureArgs.join(' ')} ${quoteShellArg(
      'env'
    )}`;
    const { stdout } = await execRaw(client, capture, CAPTURE_TIMEOUT_MS);
    return includeRemoteUserBinDirs(parseRemoteEnvOutput(stdout));
  } catch {
    try {
      const { stdout } = await execRaw(client, 'env', CAPTURE_TIMEOUT_MS);
      return includeRemoteUserBinDirs(parseRemoteEnvOutput(stdout));
    } catch {
      return {};
    }
  }
}

function shouldForwardEnvKey(key: string): boolean {
  return isValidEnvVarName(key) && !VOLATILE_ENV_KEYS.has(key);
}

function withoutShellEnv(env: Record<string, string>): Record<string, string> {
  const { SHELL: _shell, ...rest } = env;
  return rest;
}

function execRaw(
  client: RemoteShellExecClient,
  command: string,
  timeoutMs: number
): Promise<RawExecResult> {
  return new Promise((resolve, reject) => {
    let stream: ClientChannel | undefined;
    let settled = false;
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stream?.destroy();
      reject(new Error(`Remote command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    client.exec(command, (err, channel) => {
      if (settled) return;
      if (err) {
        clearTimeout(timer);
        settled = true;
        reject(err);
        return;
      }

      stream = channel;
      channel.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      channel.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });
      channel.on('close', (exitCode: number | null) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        if ((exitCode ?? 0) === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(
          Object.assign(new Error(stderr || `Process exited with code ${exitCode}`), {
            stdout,
            stderr,
            exitCode,
          })
        );
      });
      channel.on('error', (error: Error) => {
        if (settled) return;
        clearTimeout(timer);
        settled = true;
        reject(error);
      });
    });
  });
}
