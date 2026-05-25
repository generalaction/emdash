export type LifecycleScriptInputOptions = {
  exit?: boolean;
  shellKind?: 'cmd' | 'posix';
  platform?: NodeJS.Platform;
};

function splitScriptLines(script: string): string[] {
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
  const lines = splitScriptLines(script);

  if (shellKind === 'cmd') {
    const body = lines.join(' & ');
    if (!body) return exit ? 'exit' : '';
    return exit ? `${body} & exit` : body;
  }

  const body = lines.join('\n');
  if (!body) return exit ? 'exit' : '';
  return exit ? `${body}; exit` : body;
}
