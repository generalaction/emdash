import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { quoteShellArg } from '../../utils/shellEscape';
import type { SshClientProxy } from '../ssh/ssh-client-proxy';

const execFileAsync = promisify(execFile);

function resolveGitBin(): string {
  const candidates = [
    (process.env.GIT_PATH || '').trim(),
    '/opt/homebrew/bin/git',
    '/usr/local/bin/git',
    '/usr/bin/git',
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return 'git';
}

const GIT = resolveGitBin();

export type ExecFn = (
  command: string,
  args?: string[],
  options?: { cwd?: string; timeout?: number; maxBuffer?: number }
) => Promise<{ stdout: string; stderr: string }>;

export function getLocalExec(): ExecFn {
  return (
    command: string,
    args: string[] = [],
    options: { cwd?: string; timeout?: number; maxBuffer?: number } = {}
  ) => {
    const bin = command === 'git' ? GIT : command;
    return execFileAsync(bin, args, options);
  };
}

async function addGithubTokenHeader(
  args: string[],
  getToken: () => Promise<string | null>
): Promise<string[]> {
  const rawToken = await getToken();
  if (!rawToken) return args;

  const token = Buffer.from(`x-access-token:${rawToken}`).toString('base64');
  if (!token) return args;

  return ['-c', `http.https://github.com/.extraHeader=Authorization: Basic ${token}`, ...args];
}

export function getGitLocalExec(getToken: () => Promise<string | null>): ExecFn {
  const baseExec = getLocalExec();
  return async (command, args = [], options = {}) => {
    if (command === 'git') {
      args = await addGithubTokenHeader(args, getToken);
    }
    return baseExec(command, args, options);
  };
}

export function getSshExec(proxy: SshClientProxy): ExecFn {
  return (
    command: string,
    args: string[] = [],
    { cwd }: { cwd?: string; timeout?: number; maxBuffer?: number } = {}
  ) => {
    const escaped = args.map(quoteShellArg).join(' ');
    const inner = args.length ? `${command} ${escaped}` : command;
    const withCwd = cwd ? `cd ${quoteShellArg(cwd)} && ${inner}` : inner;
    const full = `bash -l -c ${quoteShellArg(withCwd)}`;

    return new Promise((resolve, reject) => {
      proxy.client.exec(full, (execErr, stream) => {
        if (execErr) return reject(execErr);
        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number | null) => {
          if ((code ?? 0) === 0) {
            resolve({ stdout, stderr });
          } else {
            const e = Object.assign(new Error(stderr || `Process exited with code ${code}`), {
              stdout,
              stderr,
            });
            reject(e);
          }
        });
        stream.on('data', (d: Buffer) => {
          stdout += d.toString('utf-8');
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString('utf-8');
        });
        stream.on('error', reject);
      });
    });
  };
}

export function getGitSshExec(
  proxy: SshClientProxy,
  getToken: () => Promise<string | null>
): ExecFn {
  const baseExec = getSshExec(proxy);
  return async (command, args = [], options = {}) => {
    if (command === 'git') {
      args = await addGithubTokenHeader(args, getToken);
    }
    return baseExec(command, args, options);
  };
}
