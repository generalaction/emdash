import { getWindowsEnvValue } from '#primitives/agent-env/api';
import { formatCommandLine, quoteArg } from '#primitives/exec/api';
import { planExecutableLaunch, type FileExists } from '#primitives/exec/node';
import { buildTmuxShellLine } from './tmux';

export type ResolvedPtyShellProfile = {
  id: string;
  resolvedShellId: string;
  resolvedFromSystem: boolean;
  executable: string;
  available?: true;
  family: 'posix' | 'csh' | 'windows-cmd' | 'powershell' | 'wsl';
  interactiveArgs: string[];
  commandArgs: string[];
  envCaptureArgs?: string[];
  capturedEnv?: Record<string, string>;
  remotePathLookup?: boolean;
};

export type PtyCommandSpec =
  | { kind: 'argv'; command: string; args: string[] }
  | { kind: 'shell-line'; commandLine: string };

export type PtySpawnIntent =
  | {
      kind: 'interactive-shell';
      cwd: string;
      shellProfile?: ResolvedPtyShellProfile;
      shellSetup?: string;
      tmuxSessionName?: string;
    }
  | {
      kind: 'run-command';
      cwd: string;
      command: PtyCommandSpec;
      shellProfile?: ResolvedPtyShellProfile;
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

function getPosixShell(env: NodeJS.ProcessEnv): string {
  return env.SHELL || '/bin/sh';
}

function getWindowsShell(env: NodeJS.ProcessEnv): string {
  return getWindowsEnvValue(env, 'ComSpec') || 'C:\\Windows\\System32\\cmd.exe';
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
    case 'wsl':
      return intent.shellProfile.commandArgs;
  }
}

function argvToPosixShellLine(intent: PtySpawnIntent, command: string, args: string[]): string {
  const family = intent.shellProfile?.family === 'csh' ? 'csh' : 'posix';
  return formatCommandLine({ command, args }, family);
}

function wrapCmdExeCommandLine(commandLine: string): string {
  return commandLine.startsWith('"') ? `"${commandLine}"` : commandLine;
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
      shellProfile?.family === 'powershell' || shellProfile?.family === 'wsl'
        ? [...commandArgs, commandLine]
        : [...commandArgs, wrapCmdExeCommandLine(commandLine)],
    cwd,
    warnings,
  };
}

function resolveWindowsSpawn(
  intent: PtySpawnIntent,
  env: NodeJS.ProcessEnv,
  fileExists?: FileExists
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
  if (intent.shellProfile?.family === 'wsl') {
    return windowsShellLineSpawn({
      commandLine: argvToPosixShellLine(intent, command, args),
      cwd: intent.cwd,
      env,
      shellProfile: intent.shellProfile,
      warnings,
    });
  }

  const plan = planExecutableLaunch({
    platform: 'win32',
    command,
    args,
    cwd: intent.cwd,
    env,
    shellProfile: intent.shellProfile,
    fileExists,
  });
  return { command: plan.executable, args: plan.args, cwd: intent.cwd, warnings };
}

function resolvePosixSpawn(
  intent: PtySpawnIntent,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): ResolvedLocalPtySpawn {
  const shell = getResolvedShell(intent, env);
  const interactiveArgs = getInteractiveArgs(intent);
  const commandArgs = getCommandArgs(intent);
  const setupWrapperArgs = getSetupWrapperArgs(intent);

  if (intent.kind === 'interactive-shell') {
    if (intent.tmuxSessionName) {
      const commandLine = intent.shellSetup
        ? `${intent.shellSetup} && exec ${quoteArg(shell, 'posix')} ${interactiveArgs.join(' ')}`
        : `exec ${quoteArg(shell, 'posix')} ${interactiveArgs.join(' ')}`;
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
          `${intent.shellSetup} && exec ${quoteArg(shell, 'posix')} ${interactiveArgs.join(' ')}`,
        ],
        cwd: intent.cwd,
        warnings: [],
      };
    }

    return { command: shell, args: interactiveArgs, cwd: intent.cwd, warnings: [] };
  }

  if (
    intent.shellProfile?.family === 'powershell' ||
    intent.shellProfile?.family === 'windows-cmd' ||
    intent.shellProfile?.family === 'wsl'
  ) {
    throw new Error(
      `Cannot run POSIX shell-wrapped commands through ${intent.shellProfile.resolvedShellId}`
    );
  }

  if (intent.command.kind === 'argv' && !intent.shellSetup && !intent.tmuxSessionName) {
    const plan = planExecutableLaunch({
      platform,
      command: intent.command.command,
      args: intent.command.args,
      cwd: intent.cwd,
      env,
    });
    return { command: plan.executable, args: plan.args, cwd: intent.cwd, warnings: [] };
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
  fileExists,
}: {
  intent: PtySpawnIntent;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  fileExists?: FileExists;
}): ResolvedLocalPtySpawn {
  return platform === 'win32'
    ? resolveWindowsSpawn(intent, env, fileExists)
    : resolvePosixSpawn(intent, env, platform);
}

export function logLocalPtySpawnWarnings(
  source: string,
  warnings: LocalPtySpawnWarning[],
  context: Record<string, string>,
  logger: { warn(message: string, context: Record<string, unknown>): void } = console
): void {
  if (warnings.length === 0) return;
  logger.warn(`${source}: local PTY platform warning`, { ...context, warnings });
}
