import { getWindowsEnvValue } from '#primitives/agent-env/api';
import {
  formatCommandLine,
  quoteArg,
  type CommandSpec,
  type NativeInvocation,
} from '#primitives/exec/api';
import { planExecutableLaunch, planShellLaunch, type FileExists } from '#primitives/exec/node';
import { buildTmuxShellLine } from './tmux-commands';

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

export type PtySpawnIntent =
  | {
      kind: 'interactive-shell';
      cwd: string;
      shellProfile?: ResolvedPtyShellProfile;
      shellSetup?: string;
      tmux?: { name: string; identity?: string };
    }
  | {
      kind: 'run-command';
      cwd: string;
      command: CommandSpec;
      shellProfile?: ResolvedPtyShellProfile;
      shellSetup?: string;
      tmux?: { name: string; identity?: string };
    };

export type LocalPtySpawnWarning = 'tmux_unsupported_on_windows';

export type ResolvedLocalPtySpawn = {
  invocation: NativeInvocation;
  cwd: string;
  /** The environment to spawn the invocation with. */
  env: Record<string, string>;
  warnings: LocalPtySpawnWarning[];
};

type ResolvedPlatformSpawn = Omit<ResolvedLocalPtySpawn, 'env'>;

function argvInvocation(executable: string, argv: readonly string[]): NativeInvocation {
  return { kind: 'argv', executable, argv: [...argv] };
}

function windowsCommandLineInvocation(
  executable: string,
  argumentPrefix: readonly string[],
  commandLine: string
): NativeInvocation {
  return {
    kind: 'windows-command-line',
    executable,
    rawArguments: [...argumentPrefix, wrapCmdExeCommandLine(commandLine)].join(' '),
  };
}

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
  if (intent.tmux) warnings.push('tmux_unsupported_on_windows');
  return warnings;
}

function combineShellSetup(
  setup: string | undefined,
  commandLine: string,
  family: ResolvedPtyShellProfile['family']
): string {
  if (!setup) return commandLine;
  if (family === 'powershell') return `${setup}\nif ($?) {\n${commandLine}\n}`;
  return `${setup} && ${commandLine}`;
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
}): ResolvedPlatformSpawn {
  return {
    invocation: planShellLaunch({ platform: 'win32', commandLine, env, shellProfile }),
    cwd,
    warnings,
  };
}

function resolveWindowsSpawn(
  intent: PtySpawnIntent,
  env: NodeJS.ProcessEnv,
  fileExists?: FileExists
): ResolvedPlatformSpawn {
  const warnings = windowsWarnings(intent);
  const shell = intent.shellProfile?.executable ?? getWindowsShell(env);

  if (intent.kind === 'interactive-shell') {
    if (intent.shellSetup) {
      const family = intent.shellProfile?.family ?? 'windows-cmd';
      if (family === 'windows-cmd') {
        return {
          invocation: windowsCommandLineInvocation(shell, ['/d', '/s', '/k'], intent.shellSetup),
          cwd: intent.cwd,
          warnings,
        };
      }
      if (family === 'powershell') {
        return {
          invocation: argvInvocation(shell, ['-NoExit', '-Command', intent.shellSetup]),
          cwd: intent.cwd,
          warnings,
        };
      }
      const interactiveArgs = intent.shellProfile?.interactiveArgs ?? [];
      const reenter = formatCommandLine(
        { command: shell, args: interactiveArgs },
        family === 'csh' ? 'csh' : 'posix'
      );
      return windowsShellLineSpawn({
        commandLine: combineShellSetup(intent.shellSetup, `exec ${reenter}`, family),
        cwd: intent.cwd,
        env,
        shellProfile: intent.shellProfile,
        warnings,
      });
    }
    return {
      invocation: argvInvocation(shell, intent.shellProfile?.interactiveArgs ?? []),
      cwd: intent.cwd,
      warnings,
    };
  }

  if (intent.command.kind === 'shell-line') {
    const family = intent.shellProfile?.family ?? 'windows-cmd';
    return windowsShellLineSpawn({
      commandLine: combineShellSetup(intent.shellSetup, intent.command.commandLine, family),
      cwd: intent.cwd,
      env,
      shellProfile: intent.shellProfile,
      warnings,
    });
  }

  const { command, args } = intent.command;
  if (intent.shellSetup) {
    const family = intent.shellProfile?.family ?? 'windows-cmd';
    return windowsShellLineSpawn({
      commandLine: combineShellSetup(
        intent.shellSetup,
        formatCommandLine({ command, args }, family),
        family
      ),
      cwd: intent.cwd,
      env,
      shellProfile: intent.shellProfile,
      warnings,
    });
  }
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
  return { invocation: plan.invocation, cwd: intent.cwd, warnings };
}

function resolvePosixSpawn(
  intent: PtySpawnIntent,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): ResolvedPlatformSpawn {
  const shell = getResolvedShell(intent, env);
  const interactiveArgs = getInteractiveArgs(intent);
  const commandArgs = getCommandArgs(intent);
  const setupWrapperArgs = getSetupWrapperArgs(intent);

  if (intent.kind === 'interactive-shell') {
    if (intent.shellSetup) {
      return {
        invocation: argvInvocation(shell, [
          ...setupWrapperArgs,
          `${intent.shellSetup} && exec ${quoteArg(shell, 'posix')} ${interactiveArgs.join(' ')}`,
        ]),
        cwd: intent.cwd,
        warnings: [],
      };
    }

    return {
      invocation: argvInvocation(shell, interactiveArgs),
      cwd: intent.cwd,
      warnings: [],
    };
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

  if (intent.command.kind === 'argv' && !intent.shellSetup) {
    const plan = planExecutableLaunch({
      platform,
      command: intent.command.command,
      args: intent.command.args,
      cwd: intent.cwd,
      env,
    });
    return { invocation: plan.invocation, cwd: intent.cwd, warnings: [] };
  }

  const commandLine =
    intent.command.kind === 'shell-line'
      ? intent.command.commandLine
      : argvToPosixShellLine(intent, intent.command.command, intent.command.args);
  const fullCommandLine = intent.shellSetup
    ? `${intent.shellSetup} && ${commandLine}`
    : commandLine;

  return {
    invocation: planShellLaunch({
      platform,
      commandLine: fullCommandLine,
      env,
      shellProfile: {
        executable: shell,
        family: intent.shellProfile?.family ?? 'posix',
        commandArgs,
      },
    }),
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
  env: Record<string, string>;
  fileExists?: FileExists;
}): ResolvedLocalPtySpawn {
  if (platform === 'win32') return { ...resolveWindowsSpawn(intent, env, fileExists), env };

  const resolved = resolvePosixSpawn(intent, env, platform);
  if (!intent.tmux) return { ...resolved, env };
  const { invocation } = resolved;
  if (invocation.kind !== 'argv') throw new Error('tmux requires a POSIX argv invocation');

  const launch = buildTmuxShellLine(
    intent.tmux.name,
    { command: invocation.executable, args: [...invocation.argv] },
    env,
    intent.tmux.identity
  );
  return {
    ...resolved,
    invocation: argvInvocation('/bin/sh', ['-c', launch.shellLine]),
    env: launch.env,
  };
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
