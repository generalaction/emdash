import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_REMOTE_SHELL,
  normalizeRemoteShell,
  type RemoteShellProfile,
} from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { quoteShellArg } from '@main/utils/shellEscape';
import {
  isExplicitTerminalShellId,
  terminalCommandArgs,
  terminalEnvCaptureArgs,
  terminalInteractiveShellArgs,
  terminalShellBasename,
  terminalShellDisplayName,
  terminalShellFamily,
  type ExplicitTerminalShellId,
  type TerminalShellAvailability,
  type TerminalShellId,
} from '@shared/terminal-settings';
import type { ResolvedShellProfile } from './types';

export type ShellTarget =
  | { kind: 'local'; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv }
  | { kind: 'ssh'; profile: RemoteShellProfile; proxy?: SshClientProxy };

export class ShellUnavailableError extends Error {
  constructor(
    readonly shell: TerminalShellId,
    readonly target: ShellTarget['kind'],
    message = `${terminalShellDisplayName(shell)} is not available on the ${target} target`
  ) {
    super(message);
    this.name = 'ShellUnavailableError';
  }
}

type FileExists = (candidate: string) => boolean;

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function pathDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const rawPath =
    platform === 'win32' ? (env.Path ?? env.PATH ?? env.path ?? '') : (env.PATH ?? '');
  return rawPath
    .split(platform === 'win32' ? path.win32.delimiter : path.delimiter)
    .filter(Boolean);
}

function windowsPathExts(env: NodeJS.ProcessEnv): string[] {
  const raw = env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
  return raw
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
}

function findOnPath(
  shell: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  fileExists: FileExists = isExecutable
): string | undefined {
  const pathApi = platform === 'win32' ? path.win32 : path;
  if (pathApi.isAbsolute(shell) && fileExists(shell)) return shell;

  for (const dir of pathDirs(env, platform)) {
    const candidate = pathApi.join(dir, shell);
    if (fileExists(candidate)) return candidate;

    if (platform === 'win32' && !path.extname(shell)) {
      for (const ext of windowsPathExts(env)) {
        const winCandidate = `${candidate}${ext}`;
        if (fileExists(winCandidate)) return winCandidate;
      }
    }
  }

  return undefined;
}

function shellIdFromExecutable(
  executable: string,
  fallback: ExplicitTerminalShellId
): ExplicitTerminalShellId {
  const base = terminalShellBasename(executable).replace(/\.exe$/, '');
  return isExplicitTerminalShellId(base) ? base : fallback;
}

function shellLabelFromExecutable(executable: string, fallback: ExplicitTerminalShellId): string {
  const base = terminalShellBasename(executable).replace(/\.exe$/, '');
  return base || terminalShellDisplayName(fallback);
}

function localDefaultShell(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform === 'win32') return env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
  return env.SHELL ?? (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

function resolveLocalExplicitShell(
  shell: ExplicitTerminalShellId,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  fileExists?: FileExists
): string | undefined {
  if (platform === 'win32') {
    if (shell === 'cmd') return env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
    if (shell === 'powershell')
      return findOnPath('powershell.exe', env, platform, fileExists) ?? 'powershell.exe';
    if (shell === 'pwsh') return findOnPath('pwsh.exe', env, platform, fileExists);
    return findOnPath(shell, env, platform, fileExists);
  }

  if (shell === 'cmd' || shell === 'powershell') return undefined;
  return findOnPath(shell, env, platform, fileExists);
}

function buildProfile({
  id,
  resolvedShellId,
  executable,
  resolvedFromAuto,
  capturedEnv,
  remotePathLookup,
  shellForArgs = resolvedShellId,
  displayName,
}: {
  id: ExplicitTerminalShellId | 'target-default';
  resolvedShellId: ExplicitTerminalShellId;
  executable: string;
  resolvedFromAuto: boolean;
  capturedEnv?: Record<string, string>;
  remotePathLookup?: boolean;
  shellForArgs?: string;
  displayName?: string;
}): ResolvedShellProfile {
  const family = terminalShellFamily(shellForArgs);
  return {
    id,
    resolvedShellId,
    resolvedFromAuto,
    executable,
    displayName:
      displayName ??
      (resolvedFromAuto
        ? `Auto - ${terminalShellDisplayName(resolvedShellId)}`
        : terminalShellDisplayName(resolvedShellId)),
    available: true,
    family,
    interactiveArgs: terminalInteractiveShellArgs(shellForArgs),
    commandArgs: terminalCommandArgs(shellForArgs),
    envCaptureArgs: terminalEnvCaptureArgs(shellForArgs),
    capturedEnv,
    remotePathLookup,
  };
}

export async function resolveTerminalShell({
  intent,
  target,
  fileExists,
}: {
  intent: TerminalShellId;
  target: ShellTarget;
  fileExists?: FileExists;
}): Promise<ResolvedShellProfile> {
  if (target.kind === 'local') {
    const platform = target.platform ?? process.platform;
    const env = target.env ?? process.env;

    if (intent === 'auto') {
      const executable = localDefaultShell(platform, env);
      const resolvedShellId = shellIdFromExecutable(
        executable,
        platform === 'win32' ? 'cmd' : 'sh'
      );
      return buildProfile({
        id: 'target-default',
        resolvedShellId,
        executable,
        resolvedFromAuto: true,
        shellForArgs: executable,
        displayName: `Auto - ${shellLabelFromExecutable(executable, resolvedShellId)}`,
      });
    }

    const executable = resolveLocalExplicitShell(intent, platform, env, fileExists);
    if (!executable) throw new ShellUnavailableError(intent, 'local');
    return buildProfile({
      id: intent,
      resolvedShellId: intent,
      executable,
      resolvedFromAuto: false,
    });
  }

  if (intent === 'auto') {
    const executable = normalizeRemoteShell(target.profile.shell);
    const resolvedShellId = shellIdFromExecutable(executable, 'sh');
    return buildProfile({
      id: 'target-default',
      resolvedShellId,
      executable,
      resolvedFromAuto: true,
      capturedEnv: target.profile.env,
      shellForArgs: executable,
      displayName: `Auto - ${shellLabelFromExecutable(executable, resolvedShellId)}`,
    });
  }

  if (target.proxy && !(await isRemoteShellAvailable(target.proxy, intent, target.profile.env))) {
    throw new ShellUnavailableError(intent, 'ssh');
  }

  return buildProfile({
    id: intent,
    resolvedShellId: intent,
    executable: intent,
    resolvedFromAuto: false,
    capturedEnv: target.profile.env,
    remotePathLookup: true,
  });
}

export async function getLocalTerminalShellAvailability({
  platform = process.platform,
  env = process.env,
  fileExists,
}: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  fileExists?: FileExists;
} = {}): Promise<TerminalShellAvailability[]> {
  const targetDefaultShell = localDefaultShell(platform, env);
  const targetDefaultId = shellIdFromExecutable(
    targetDefaultShell,
    platform === 'win32' ? 'cmd' : 'sh'
  );
  return sortShellAvailability(
    shellIdsForLocalPlatform(platform).map((shell) => {
      if (shell === 'auto') {
        return {
          shell,
          displayName: `Auto - ${shellLabelFromExecutable(targetDefaultShell, targetDefaultId)}`,
          available: true,
        };
      }
      const executable = resolveLocalExplicitShell(shell, platform, env, fileExists);
      return {
        shell,
        displayName: terminalShellDisplayName(shell),
        available: executable !== undefined,
        reason: executable === undefined ? 'Not found on this machine' : undefined,
      };
    })
  );
}

export async function getRemoteTerminalShellAvailability(
  proxy: SshClientProxy,
  profile: RemoteShellProfile
): Promise<TerminalShellAvailability[]> {
  const targetDefaultId = shellIdFromExecutable(normalizeRemoteShell(profile.shell), 'sh');
  const availability = await Promise.all(
    remoteShellIds().map(async (shell) => {
      if (shell === 'auto') {
        return {
          shell,
          displayName: `Auto - ${terminalShellDisplayName(targetDefaultId)}`,
          available: true,
        };
      }
      const available = await isRemoteShellAvailable(proxy, shell, profile.env);
      return {
        shell,
        displayName: terminalShellDisplayName(shell),
        available,
        reason: available ? undefined : 'Not found on this SSH target',
      };
    })
  );
  return sortShellAvailability(availability);
}

async function isRemoteShellAvailable(
  proxy: SshClientProxy,
  shell: ExplicitTerminalShellId,
  env: Record<string, string>
): Promise<boolean> {
  if (shell === 'cmd' || shell === 'powershell') return false;
  const pathPrefix = env.PATH ? `PATH=${quoteShellArg(env.PATH)} ` : '';
  const command = `${pathPrefix}command -v ${quoteShellArg(shell)} >/dev/null 2>&1`;
  try {
    const result = await execRemote(proxy, `${DEFAULT_REMOTE_SHELL} -c ${quoteShellArg(command)}`);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function shellIdsForLocalPlatform(platform: NodeJS.Platform): TerminalShellId[] {
  if (platform === 'win32') return ['auto', 'cmd', 'powershell', 'pwsh', 'bash'];
  return ['auto', 'bash', 'csh', 'dash', 'ksh', 'pwsh', 'sh', 'tcsh', 'zsh'];
}

function remoteShellIds(): TerminalShellId[] {
  return ['auto', 'bash', 'csh', 'dash', 'ksh', 'pwsh', 'sh', 'tcsh', 'zsh'];
}

function sortShellAvailability(entries: TerminalShellAvailability[]): TerminalShellAvailability[] {
  return [...entries].sort((a, b) => {
    if (a.shell === 'auto') return -1;
    if (b.shell === 'auto') return 1;
    if (a.available !== b.available) return a.available ? -1 : 1;
    return 0;
  });
}

function execRemote(
  proxy: SshClientProxy,
  command: string
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    proxy.exec(command, (err, channel) => {
      if (err) {
        reject(err);
        return;
      }
      channel.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf-8');
      });
      channel.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });
      channel.on('close', (code: number | null) => {
        resolve({ exitCode: code, stdout, stderr });
      });
      channel.on('error', reject);
    });
  });
}
