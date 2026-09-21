import { getWindowsEnvValue } from '#primitives/agent-env/api';
import type { NativeInvocation, ShellFamily } from '#primitives/exec/api';

/** Plan an explicitly requested shell script; never infer shell syntax from an executable. */
export function planShellLaunch({
  platform,
  commandLine,
  env,
  shellProfile,
}: {
  platform: NodeJS.Platform;
  commandLine: string;
  env: Readonly<NodeJS.ProcessEnv>;
  shellProfile?: { executable: string; family: ShellFamily; commandArgs: string[] };
}): NativeInvocation {
  const windows = platform === 'win32';
  const executable =
    shellProfile?.executable ??
    (windows ? getWindowsEnvValue(env, 'ComSpec') || 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh');
  const args = shellProfile?.commandArgs ?? (windows ? ['/d', '/s', '/c'] : ['-c']);
  const family = shellProfile?.family ?? (windows ? 'windows-cmd' : 'posix');
  if (family === 'windows-cmd') {
    const wrapped = commandLine.startsWith('"') ? `"${commandLine}"` : commandLine;
    return {
      kind: 'windows-command-line',
      executable,
      rawArguments: [...args, wrapped].join(' '),
    };
  }
  return { kind: 'argv', executable, argv: [...args, commandLine] };
}
