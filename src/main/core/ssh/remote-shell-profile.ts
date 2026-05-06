import type { Client, ClientChannel } from 'ssh2';
import { isValidEnvVarName, quoteShellArg } from '@main/utils/shellEscape';
import { parseRemoteEnvOutput, SHELL_ENV_CAPTURE_GUARD } from '@main/utils/userEnv';

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

const LOGIN_SHELLS = new Set(['bash', 'ksh', 'zsh']);
const BASIC_POSIX_SHELLS = new Set(['dash', 'sh']);
const SUPPORTED_REMOTE_SHELLS = new Set([...BASIC_POSIX_SHELLS, ...LOGIN_SHELLS]);
const VOLATILE_ENV_KEYS = new Set(['_', 'PWD', 'OLDPWD', 'SHLVL', 'COLUMNS', 'LINES']);

type RawExecResult = {
  stdout: string;
  stderr: string;
};

export function normalizeRemoteShell(raw: string | undefined | null): string {
  const shell = raw?.trim();
  if (!shell || !shell.startsWith('/') || !SUPPORTED_REMOTE_SHELLS.has(shellBasename(shell))) {
    return DEFAULT_REMOTE_SHELL;
  }
  return shell;
}

function buildRemoteShellEnvPrefix(env: Record<string, string>): string {
  const exports = Object.entries(env)
    .filter(([key]) => shouldForwardEnvKey(key))
    .map(([key, value]) => `export ${key}=${quoteShellArg(value)}`);

  return exports.length > 0 ? `${exports.join('; ')}; ` : '';
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
  const prefix = `${buildRemoteShellEnvPrefix(profile.env)}${buildRemoteShellEnvPrefix(env)}`;
  return `${quoteShellArg(shell)} ${remoteShellCommandFlag(shell)} ${quoteShellArg(
    `${prefix}${command}`
  )}`;
}

export async function captureRemoteShellProfile(client: Client): Promise<RemoteShellProfile> {
  const shell = await resolveRemoteShell(client);
  const env = await captureRemoteEnv(client, shell);
  return { shell, env };
}

async function resolveRemoteShell(client: Client): Promise<string> {
  try {
    const { stdout } = await execRaw(client, 'printf %s "$SHELL"', SHELL_TIMEOUT_MS);
    return normalizeRemoteShell(stdout);
  } catch {
    return DEFAULT_REMOTE_SHELL;
  }
}

async function captureRemoteEnv(client: Client, shell: string): Promise<Record<string, string>> {
  try {
    const guard = buildRemoteShellProcessEnvPrefix(SHELL_ENV_CAPTURE_GUARD);
    const capture = `${guard}${quoteShellArg(shell)} ${remoteShellEnvCaptureFlag(
      shell
    )} ${quoteShellArg('env')}`;
    const { stdout } = await execRaw(client, capture, CAPTURE_TIMEOUT_MS);
    return parseRemoteEnvOutput(stdout);
  } catch {
    try {
      const { stdout } = await execRaw(client, 'env', CAPTURE_TIMEOUT_MS);
      return parseRemoteEnvOutput(stdout);
    } catch {
      return {};
    }
  }
}

function shouldForwardEnvKey(key: string): boolean {
  return isValidEnvVarName(key) && !VOLATILE_ENV_KEYS.has(key);
}

function remoteShellCommandFlag(shell: string): string {
  return BASIC_POSIX_SHELLS.has(shellBasename(shell)) ? '-c' : '-lc';
}

function remoteShellEnvCaptureFlag(shell: string): string {
  return BASIC_POSIX_SHELLS.has(shellBasename(shell)) ? '-ic' : '-ilc';
}

function shellBasename(shell: string): string {
  return shell.split('/').pop() ?? '';
}

function execRaw(client: Client, command: string, timeoutMs: number): Promise<RawExecResult> {
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
