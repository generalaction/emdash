import { existsSync } from 'node:fs';
import path from 'node:path';
import { getWindowsEnvValue } from '#primitives/agent-env/api';
import { formatCommandLine, type NativeInvocation } from '#primitives/exec/api';

export type ExecutableLaunchDiagnostic = {
  type: 'command-not-found';
  command: string;
};

export type ExecutableShellProfile = {
  family: 'posix' | 'csh' | 'windows-cmd' | 'powershell' | 'wsl';
  executable: string;
};

export type ExecutableLaunchPlan = {
  invocation: NativeInvocation;
  cwd: string | undefined;
  diagnostics: ExecutableLaunchDiagnostic[];
};

export type ChildProcessLaunch = {
  executable: string;
  args: string[];
  windowsVerbatimArguments: boolean;
};

export type FileExists = (candidate: string) => boolean;

export type PlanExecutableLaunchOptions = {
  platform: NodeJS.Platform;
  command: string;
  args: readonly string[];
  cwd?: string;
  env?: Readonly<NodeJS.ProcessEnv>;
  shellProfile?: ExecutableShellProfile;
  fileExists?: FileExists;
};

export function planExecutableLaunch({
  platform,
  command,
  args,
  cwd,
  env = process.env,
  shellProfile,
  fileExists = existsSync,
}: PlanExecutableLaunchOptions): ExecutableLaunchPlan {
  if (platform !== 'win32') return directPlan(command, args, cwd);

  const resolved = resolveWindowsExecutable(command, cwd, env, fileExists);
  const executable = resolved.path;
  const diagnostics: ExecutableLaunchDiagnostic[] = resolved.found
    ? []
    : [{ type: 'command-not-found', command }];
  const extension = path.win32.extname(executable).toLowerCase();

  if (extension === '.cmd' || extension === '.bat') {
    const commandLine = formatCommandLine({ command: executable, args: [...args] }, 'windows-cmd');
    return {
      invocation: {
        kind: 'windows-command-line',
        executable: resolveCmdExecutable(env),
        rawArguments: `/d /s /c ${wrapCmdExeCommandLine(commandLine)}`,
      },
      cwd,
      diagnostics,
    };
  }

  if (extension === '.ps1') {
    const selectedPowerShell = shellProfile?.family === 'powershell' ? shellProfile : undefined;
    return {
      invocation: {
        kind: 'argv',
        executable:
          selectedPowerShell?.executable ?? resolveWindowsPowerShell(env, cwd, fileExists),
        argv: [
          selectedPowerShell ? '-NoLogo' : '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          executable,
          ...args,
        ],
      },
      cwd,
      diagnostics,
    };
  }

  return {
    ...directPlan(executable, args, cwd),
    diagnostics,
  };
}

function directPlan(
  executable: string,
  args: readonly string[],
  cwd: string | undefined
): ExecutableLaunchPlan {
  return {
    invocation: { kind: 'argv', executable, argv: [...args] },
    cwd,
    diagnostics: [],
  };
}

export function toChildProcessLaunch(invocation: NativeInvocation): ChildProcessLaunch {
  switch (invocation.kind) {
    case 'argv':
      return {
        executable: invocation.executable,
        args: [...invocation.argv],
        windowsVerbatimArguments: false,
      };
    case 'windows-command-line':
      return {
        executable: invocation.executable,
        args: [invocation.rawArguments],
        windowsVerbatimArguments: true,
      };
  }
}

function resolveWindowsExecutable(
  command: string,
  cwd: string | undefined,
  env: Readonly<NodeJS.ProcessEnv>,
  fileExists: FileExists
): { path: string; found: boolean } {
  const hasSeparator = command.includes('\\') || command.includes('/');
  const isAbsolute = path.win32.isAbsolute(command);
  const resolutionCwd = cwd ?? process.cwd();
  const pathCandidates = hasSeparator
    ? [isAbsolute ? command : path.win32.resolve(resolutionCwd, command)]
    : [
        path.win32.join(resolutionCwd, command),
        ...windowsPathDirs(env).map((dir) => path.win32.join(dir, command)),
      ];
  const hasExtension = path.win32.extname(command).length > 0;
  const extensions = hasExtension ? [''] : [...windowsPathExtensions(env), ''];

  for (const base of pathCandidates) {
    for (const extension of extensions) {
      const candidate = `${base}${extension}`;
      if (fileExists(candidate)) return { path: candidate, found: true };
    }
  }

  if (hasSeparator && !isAbsolute) {
    return { path: path.win32.resolve(resolutionCwd, command), found: false };
  }
  return { path: command, found: false };
}

function windowsPathDirs(env: Readonly<NodeJS.ProcessEnv>): string[] {
  return (getWindowsEnvValue(env, 'PATH') ?? '')
    .split(path.win32.delimiter)
    .map(stripSurroundingDoubleQuotes)
    .filter(Boolean);
}

function windowsPathExtensions(env: Readonly<NodeJS.ProcessEnv>): string[] {
  const raw = getWindowsEnvValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD';
  return raw
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean)
    .map((extension) => (extension.startsWith('.') ? extension : `.${extension}`));
}

function resolveCmdExecutable(env: Readonly<NodeJS.ProcessEnv>): string {
  const comSpec = getWindowsEnvValue(env, 'ComSpec');
  if (comSpec) return stripSurroundingDoubleQuotes(comSpec);
  const systemRoot = getWindowsEnvValue(env, 'SystemRoot') ?? getWindowsEnvValue(env, 'windir');
  return systemRoot ? path.win32.join(systemRoot, 'System32', 'cmd.exe') : 'cmd.exe';
}

function resolveWindowsPowerShell(
  env: Readonly<NodeJS.ProcessEnv>,
  cwd: string | undefined,
  fileExists: FileExists
): string {
  const systemRoot = getWindowsEnvValue(env, 'SystemRoot') ?? getWindowsEnvValue(env, 'windir');
  const systemPowerShell = systemRoot
    ? path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : undefined;
  if (systemPowerShell && fileExists(systemPowerShell)) return systemPowerShell;
  const resolved = resolveWindowsExecutable('powershell.exe', cwd, env, fileExists);
  return resolved.found ? resolved.path : 'powershell.exe';
}

function stripSurroundingDoubleQuotes(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
}

function wrapCmdExeCommandLine(commandLine: string): string {
  return commandLine.startsWith('"') ? `"${commandLine}"` : commandLine;
}
