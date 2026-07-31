import path from 'node:path';

type ResolvedCommand = {
  command: string;
  args: string[];
  ptyCommandLine?: string;
  windowsVerbatimArguments?: boolean;
};

const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

function escapeCmdCommand(command: string): string {
  return command.replace(CMD_META_CHARS, '^$1');
}

function escapeCmdArgument(argument: string, doubleEscapeMetaChars: boolean): string {
  let escaped = argument.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  escaped = escaped.replace(/(?=(\\+?)?)\1$/, '$1$1');
  escaped = `"${escaped}"`.replace(CMD_META_CHARS, '^$1');
  if (doubleEscapeMetaChars) escaped = escaped.replace(CMD_META_CHARS, '^$1');
  return escaped;
}

export function resolveWindowsScriptCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  trustedScript: boolean
): ResolvedCommand {
  if (platform !== 'win32' || !trustedScript) return { command, args };

  const extension = path.win32.extname(command).toLowerCase();
  if (extension === '.cmd' || extension === '.bat') {
    const doubleEscapeMetaChars = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(command);
    const commandLine = [
      escapeCmdCommand(path.win32.normalize(command)),
      ...args.map((argument) => escapeCmdArgument(argument, doubleEscapeMetaChars)),
    ].join(' ');
    const shellCommand = `"${commandLine}"`;
    return {
      command: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe',
      args: ['/d', '/s', '/c', shellCommand],
      ptyCommandLine: `/d /s /c ${shellCommand}`,
      windowsVerbatimArguments: true,
    };
  }

  return { command, args };
}
