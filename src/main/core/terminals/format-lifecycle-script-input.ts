export type LifecycleScriptShellKind = 'cmd' | 'posix';

export type LifecycleScriptInputOptions = {
  exit?: boolean;
  shellKind?: LifecycleScriptShellKind;
  platform?: NodeJS.Platform;
};

function splitCmdScriptLines(script: string): string[] {
  return script
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

/**
 * Formats lifecycle script text for writing into an interactive shell PTY.
 * Windows cmd.exe does not treat bare LF as a command boundary, so newline-separated
 * commands are joined with `&`. POSIX shells accept newline-separated commands as-is.
 */
export function formatLifecycleScriptInput(
  script: string,
  {
    exit = false,
    platform = process.platform,
    shellKind = platform === 'win32' ? 'cmd' : 'posix',
  }: LifecycleScriptInputOptions = {}
): string {
  if (shellKind === 'cmd') {
    // `&` continues on error, matching POSIX shells without `set -e`.
    const body = splitCmdScriptLines(script).join(' & ');
    if (!body) return exit ? 'exit' : '';
    return exit ? `${body} & exit` : body;
  }

  if (!script) return exit ? 'exit' : '';
  return exit ? `${script}; exit` : script;
}
