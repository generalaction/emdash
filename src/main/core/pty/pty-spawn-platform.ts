import path from 'node:path';
import { log } from '@main/lib/logger';
import { buildTmuxShellLine } from './tmux-session-name';

export type PtyCommandSpec =
  | { kind: 'argv'; command: string; args: string[] }
  | { kind: 'shell-line'; commandLine: string };

export type PtySpawnIntent =
  | {
      kind: 'interactive-shell';
      cwd: string;
      shellSetup?: string;
      tmuxSessionName?: string;
    }
  | {
      kind: 'run-command';
      cwd: string;
      command: PtyCommandSpec;
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
  return env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
}

function isWindows(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

function quotePosixArg(input: string): string {
  if (input.length === 0) return "''";
  if (!/[\s'"\\$`\n\r\t;&|<>(){}[\]*?!]/.test(input)) return input;
  return `'${input.replace(/'/g, "'\\''")}'`;
}

function argvToPosixShellLine(command: string, args: string[]): string {
  return [command, ...args].map(quotePosixArg).join(' ');
}

function quoteForCmdExe(input: string): string {
  if (input.length === 0) return '""';
  if (!/[\s"^&|<>()%!]/.test(input)) return input;
  return `"${input
    .replace(/%/g, '%%')
    .replace(/!/g, '^!')
    .replace(/(["^&|<>()])/g, '^$1')}"`;
}

function windowsWarnings(intent: PtySpawnIntent): LocalPtySpawnWarning[] {
  const warnings: LocalPtySpawnWarning[] = [];
  if (intent.shellSetup) warnings.push('shell_setup_ignored_on_windows');
  if (intent.tmuxSessionName) warnings.push('tmux_unsupported_on_windows');
  return warnings;
}

function resolveWindowsSpawn(
  intent: PtySpawnIntent,
  env: NodeJS.ProcessEnv
): ResolvedLocalPtySpawn {
  const warnings = windowsWarnings(intent);
  const shell = getWindowsShell(env);

  if (intent.kind === 'interactive-shell') {
    return { command: shell, args: [], cwd: intent.cwd, warnings };
  }

  if (intent.command.kind === 'shell-line') {
    return {
      command: shell,
      args: ['/d', '/s', '/c', intent.command.commandLine],
      cwd: intent.cwd,
      warnings,
    };
  }

  const { command, args } = intent.command;
  const ext = path.extname(command).toLowerCase();

  if (ext === '.cmd' || ext === '.bat') {
    return {
      command: shell,
      args: ['/d', '/s', '/c', [command, ...args].map(quoteForCmdExe).join(' ')],
      cwd: intent.cwd,
      warnings,
    };
  }

  if (ext === '.ps1') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', command, ...args],
      cwd: intent.cwd,
      warnings,
    };
  }

  return { command, args, cwd: intent.cwd, warnings };
}

function resolvePosixSpawn(intent: PtySpawnIntent, env: NodeJS.ProcessEnv): ResolvedLocalPtySpawn {
  const shell = getPosixShell(env);

  if (intent.kind === 'interactive-shell') {
    if (intent.tmuxSessionName) {
      const commandLine = intent.shellSetup
        ? `${intent.shellSetup} && exec ${quotePosixArg(shell)} -il`
        : `exec ${quotePosixArg(shell)} -il`;
      return {
        command: shell,
        args: ['-c', buildTmuxShellLine(intent.tmuxSessionName, commandLine)],
        cwd: intent.cwd,
        warnings: [],
      };
    }

    if (intent.shellSetup) {
      return {
        command: shell,
        args: ['-c', `${intent.shellSetup} && exec ${quotePosixArg(shell)} -il`],
        cwd: intent.cwd,
        warnings: [],
      };
    }

    return { command: shell, args: ['-il'], cwd: intent.cwd, warnings: [] };
  }

  const commandLine =
    intent.command.kind === 'shell-line'
      ? intent.command.commandLine
      : argvToPosixShellLine(intent.command.command, intent.command.args);
  const fullCommandLine = intent.shellSetup
    ? `${intent.shellSetup} && ${commandLine}`
    : commandLine;

  if (intent.tmuxSessionName) {
    return {
      command: shell,
      args: ['-c', buildTmuxShellLine(intent.tmuxSessionName, fullCommandLine)],
      cwd: intent.cwd,
      warnings: [],
    };
  }

  return {
    command: shell,
    args: ['-c', fullCommandLine],
    cwd: intent.cwd,
    warnings: [],
  };
}

export function resolveLocalPtySpawn({
  intent,
  platform,
  env,
}: {
  intent: PtySpawnIntent;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}): ResolvedLocalPtySpawn {
  return isWindows(platform) ? resolveWindowsSpawn(intent, env) : resolvePosixSpawn(intent, env);
}

export function logLocalPtySpawnWarnings(
  source: string,
  warnings: LocalPtySpawnWarning[],
  context: Record<string, string>
): void {
  if (warnings.length === 0) return;
  log.warn(`${source}: local PTY platform warning`, { ...context, warnings });
}
