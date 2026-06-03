import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import { log } from '@main/lib/logger';
import { quoteCshArg } from '@main/utils/shellEscape';
import { getWindowsEnvValue } from '@main/utils/windows-env';
import { buildTmuxShellLine } from './tmux-session-name';

export type PtyCommandSpec =
  | { kind: 'argv'; command: string; args: string[] }
  | { kind: 'shell-line'; commandLine: string };

export type PtySpawnIntent =
  | {
      kind: 'interactive-shell';
      cwd: string;
      shellProfile?: ResolvedShellProfile;
      shellSetup?: string;
      tmuxSessionName?: string;
    }
  | {
      kind: 'run-command';
      cwd: string;
      command: PtyCommandSpec;
      shellProfile?: ResolvedShellProfile;
      shellSetup?: string;
      tmuxSessionName?: string;
    };

export type LocalPtySpawnWarning = 'shell_setup_ignored_on_windows' | 'tmux_unsupported_on_windows';

export type ResolvedLocalPtySpawn = {
  command: string;
  args: string[];
  cwd: string;
  warnings: LocalPtySpawnWarning[];
};

type FileExists = (candidate: string) => boolean;

function getPosixShell(env: NodeJS.ProcessEnv): string {
  return env.SHELL || '/bin/sh';
}

function getWindowsShell(env: NodeJS.ProcessEnv): string {
  return env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
}

function getResolvedShell(intent: PtySpawnIntent, env: NodeJS.ProcessEnv): string {
  return intent.shellProfile?.executable ?? getPosixShell(env);
}

function getInteractiveArgs(intent: PtySpawnIntent): string[] {
  return intent.shellProfile?.interactiveArgs ?? ['-il'];
}

function getCommandArgs(intent: PtySpawnIntent): string[] {
  return intent.shellProfile?.commandArgs ?? ['-c'];
}

function getSetupWrapperArgs(intent: PtySpawnIntent): string[] {
  if (!intent.shellProfile) return ['-c'];
  switch (intent.shellProfile.family) {
    case 'posix':
    case 'csh':
      return ['-c'];
    case 'windows-cmd':
    case 'powershell':
      return intent.shellProfile.commandArgs;
  }
}

function shellArgQuoter(intent: PtySpawnIntent): (input: string) => string {
  return intent.shellProfile?.family === 'csh' ? quoteCshArg : quotePosixArg;
}

function isWindows(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

function quotePosixArg(input: string): string {
  if (input.length === 0) return "''";
  if (!/[\s'"\\$`\n\r\t;&|<>(){}[\]*?!]/.test(input)) return input;
  return `'${input.replace(/'/g, "'\\''")}'`;
}

function argvToPosixShellLine(intent: PtySpawnIntent, command: string, args: string[]): string {
  return [command, ...args].map(shellArgQuoter(intent)).join(' ');
}

function quoteForCmdExe(input: string): string {
  if (input.length === 0) return '""';
  if (!/[\s"^&|<>()%!]/.test(input)) return input;
  return `"${input
    .replace(/%/g, '%%')
    .replace(/!/g, '^!')
    .replace(/(["^&|<>()])/g, '^$1')}"`;
}

function quoteForPowerShell(input: string): string {
  if (input.length === 0) return "''";
  if (!/[\s'`"$;&|<>(){}[\],]/.test(input)) return input;
  return `'${input.replace(/'/g, "''")}'`;
}

/**
 * cmd.exe + /S /C has a quirk: if the command string starts with a quote, the
 * outer quotes are taken as part of the executable name (printed back as
 * `'"C:\Program Files\..."' is not recognized`). The documented workaround is
 * to wrap the entire command line in an extra pair of outer quotes so cmd.exe
 * strips one layer and runs the still-quoted path.
 */
function wrapCmdExeCommandLine(commandLine: string): string {
  return commandLine.startsWith('"') ? `"${commandLine}"` : commandLine;
}

function getWindowsPathDirs(env: NodeJS.ProcessEnv): string[] {
  const rawPath = getWindowsEnvValue(env, 'PATH') ?? '';
  return rawPath.split(path.win32.delimiter).filter(Boolean);
}

function getWindowsPathExts(
  env: NodeJS.ProcessEnv,
  options: { powershell?: boolean } = {}
): string[] {
  const rawPathExt =
    getWindowsEnvValue(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';
  const exts = rawPathExt
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
  if (!options.powershell) return exts;

  const normalized = new Set(exts.map((ext) => ext.toUpperCase()));
  if (!normalized.has('.PS1')) exts.push('.PS1');

  const priority = new Map([
    ['.COM', 0],
    ['.EXE', 1],
    ['.PS1', 2],
    ['.CMD', 3],
    ['.BAT', 4],
  ]);
  return [...exts].sort((a, b) => {
    const aRank = priority.get(a.toUpperCase()) ?? 5;
    const bRank = priority.get(b.toUpperCase()) ?? 5;
    return aRank - bRank;
  });
}

function hasWindowsPathSeparator(command: string): boolean {
  return command.includes('\\') || command.includes('/');
}

function resolveWindowsCommandPath({
  command,
  cwd,
  env,
  fileExists,
  powershell = false,
}: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  fileExists: FileExists;
  powershell?: boolean;
}): string | null {
  if (path.win32.extname(command)) {
    return null;
  }

  const baseCandidates =
    hasWindowsPathSeparator(command) || path.win32.isAbsolute(command)
      ? [path.win32.isAbsolute(command) ? command : path.win32.join(cwd, command)]
      : [
          path.win32.join(cwd, command),
          ...getWindowsPathDirs(env).map((dir) => path.win32.join(dir, command)),
        ];

  for (const base of baseCandidates) {
    for (const ext of getWindowsPathExts(env, { powershell })) {
      const candidate = `${base}${ext}`;
      if (fileExists(candidate)) return candidate;
    }
  }

  return null;
}

function windowsWarnings(intent: PtySpawnIntent): LocalPtySpawnWarning[] {
  const warnings: LocalPtySpawnWarning[] = [];
  if (intent.shellSetup) warnings.push('shell_setup_ignored_on_windows');
  if (intent.tmuxSessionName) warnings.push('tmux_unsupported_on_windows');
  return warnings;
}

function windowsShellLineSpawn({
  commandLine,
  cwd,
  env,
  shellProfile,
  warnings,
}: {
  commandLine: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  shellProfile: PtySpawnIntent['shellProfile'];
  warnings: LocalPtySpawnWarning[];
}): ResolvedLocalPtySpawn {
  const shell = shellProfile?.executable ?? getWindowsShell(env);
  const commandArgs = shellProfile?.commandArgs ?? ['/d', '/s', '/c'];
  return {
    command: shell,
    args:
      shellProfile?.family === 'powershell'
        ? [...commandArgs, commandLine]
        : [...commandArgs, wrapCmdExeCommandLine(commandLine)],
    cwd,
    warnings,
  };
}

function cmdShellLineSpawn({
  commandLine,
  cwd,
  env,
  warnings,
}: {
  commandLine: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  warnings: LocalPtySpawnWarning[];
}): ResolvedLocalPtySpawn {
  return {
    command: getWindowsShell(env),
    args: ['/d', '/s', '/c', wrapCmdExeCommandLine(commandLine)],
    cwd,
    warnings,
  };
}

function powerShellFileArgs(suppressProfile: boolean): string[] {
  return [suppressProfile ? '-NoProfile' : '-NoLogo', '-ExecutionPolicy', 'Bypass', '-File'];
}

function resolveWindowsSpawn(
  intent: PtySpawnIntent,
  env: NodeJS.ProcessEnv,
  fileExists: FileExists
): ResolvedLocalPtySpawn {
  const warnings = windowsWarnings(intent);
  const shell = intent.shellProfile?.executable ?? getWindowsShell(env);

  if (intent.kind === 'interactive-shell') {
    return {
      command: shell,
      args: intent.shellProfile?.interactiveArgs ?? [],
      cwd: intent.cwd,
      warnings,
    };
  }

  if (intent.command.kind === 'shell-line') {
    return windowsShellLineSpawn({
      commandLine: intent.command.commandLine,
      cwd: intent.cwd,
      env,
      shellProfile: intent.shellProfile,
      warnings,
    });
  }

  const { command, args } = intent.command;
  const resolvedCommand =
    resolveWindowsCommandPath({
      command,
      cwd: intent.cwd,
      env,
      fileExists,
      powershell: intent.shellProfile?.family === 'powershell',
    }) ?? command;
  const ext = path.win32.extname(resolvedCommand).toLowerCase();

  if (ext === '.cmd' || ext === '.bat') {
    if (intent.shellProfile?.family === 'powershell') {
      return windowsShellLineSpawn({
        commandLine: `& ${[resolvedCommand, ...args].map(quoteForPowerShell).join(' ')}`,
        cwd: intent.cwd,
        env,
        shellProfile: intent.shellProfile,
        warnings,
      });
    }
    return cmdShellLineSpawn({
      commandLine: [resolvedCommand, ...args].map(quoteForCmdExe).join(' '),
      cwd: intent.cwd,
      env,
      warnings,
    });
  }

  if (ext === '.ps1') {
    const selectedPowerShell =
      intent.shellProfile?.family === 'powershell' ? intent.shellProfile : undefined;
    return {
      command: selectedPowerShell?.executable ?? 'powershell.exe',
      args: [...powerShellFileArgs(selectedPowerShell === undefined), resolvedCommand, ...args],
      cwd: intent.cwd,
      warnings,
    };
  }

  if (!ext) {
    if (intent.shellProfile?.family === 'powershell') {
      return windowsShellLineSpawn({
        commandLine: `& ${[command, ...args].map(quoteForPowerShell).join(' ')}`,
        cwd: intent.cwd,
        env,
        shellProfile: intent.shellProfile,
        warnings,
      });
    }
    return cmdShellLineSpawn({
      commandLine: [command, ...args].map(quoteForCmdExe).join(' '),
      cwd: intent.cwd,
      env,
      warnings,
    });
  }

  return { command: resolvedCommand, args, cwd: intent.cwd, warnings };
}

function resolvePosixSpawn(intent: PtySpawnIntent, env: NodeJS.ProcessEnv): ResolvedLocalPtySpawn {
  const shell = getResolvedShell(intent, env);
  const interactiveArgs = getInteractiveArgs(intent);
  const commandArgs = getCommandArgs(intent);
  const setupWrapperArgs = getSetupWrapperArgs(intent);

  if (intent.kind === 'interactive-shell') {
    if (intent.tmuxSessionName) {
      const commandLine = intent.shellSetup
        ? `${intent.shellSetup} && exec ${quotePosixArg(shell)} ${interactiveArgs.join(' ')}`
        : `exec ${quotePosixArg(shell)} ${interactiveArgs.join(' ')}`;
      return {
        command: shell,
        args: [
          ...(intent.shellSetup ? setupWrapperArgs : commandArgs),
          buildTmuxShellLine(intent.tmuxSessionName, commandLine),
        ],
        cwd: intent.cwd,
        warnings: [],
      };
    }

    if (intent.shellSetup) {
      return {
        command: shell,
        args: [
          ...setupWrapperArgs,
          `${intent.shellSetup} && exec ${quotePosixArg(shell)} ${interactiveArgs.join(' ')}`,
        ],
        cwd: intent.cwd,
        warnings: [],
      };
    }

    return { command: shell, args: interactiveArgs, cwd: intent.cwd, warnings: [] };
  }

  if (
    intent.shellProfile?.family === 'powershell' ||
    intent.shellProfile?.family === 'windows-cmd'
  ) {
    throw new Error(
      `Cannot run POSIX shell-wrapped commands through ${intent.shellProfile.resolvedShellId}`
    );
  }

  const commandLine =
    intent.command.kind === 'shell-line'
      ? intent.command.commandLine
      : argvToPosixShellLine(intent, intent.command.command, intent.command.args);
  const fullCommandLine = intent.shellSetup
    ? `${intent.shellSetup} && ${commandLine}`
    : commandLine;

  if (intent.tmuxSessionName) {
    return {
      command: shell,
      args: [...commandArgs, buildTmuxShellLine(intent.tmuxSessionName, fullCommandLine)],
      cwd: intent.cwd,
      warnings: [],
    };
  }

  return {
    command: shell,
    args: [...commandArgs, fullCommandLine],
    cwd: intent.cwd,
    warnings: [],
  };
}

export function resolveLocalPtySpawn({
  intent,
  platform,
  env,
  fileExists = existsSync,
}: {
  intent: PtySpawnIntent;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fileExists?: FileExists;
}): ResolvedLocalPtySpawn {
  return isWindows(platform)
    ? resolveWindowsSpawn(intent, env, fileExists)
    : resolvePosixSpawn(intent, env);
}

export function logLocalPtySpawnWarnings(
  source: string,
  warnings: LocalPtySpawnWarning[],
  context: Record<string, string>
): void {
  if (warnings.length === 0) return;
  log.warn(`${source}: local PTY platform warning`, { ...context, warnings });
}
