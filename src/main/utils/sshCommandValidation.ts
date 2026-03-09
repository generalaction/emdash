const ALLOWED_COMMAND_PREFIXES = [
  'git ',
  'ls ',
  'pwd',
  'cat ',
  'head ',
  'tail ',
  'wc ',
  'stat ',
  'file ',
  'which ',
  'echo ',
  'test ',
  '[ ',
] as const;

const SHELL_CONTROL_CHARACTER_PATTERN = /[\r\n;&|<>`$]/;

export function getSshExecuteCommandValidationError(command: string): string | null {
  if (SHELL_CONTROL_CHARACTER_PATTERN.test(command)) {
    return 'Command contains invalid shell control characters';
  }

  const trimmed = command.trimStart();

  if (!trimmed) {
    return 'Command not allowed';
  }

  const isAllowed = ALLOWED_COMMAND_PREFIXES.some((prefix) => {
    if (prefix.endsWith(' ')) {
      return trimmed.startsWith(prefix);
    }
    return trimmed === prefix || trimmed.startsWith(prefix + ' ');
  });

  return isAllowed ? null : 'Command not allowed';
}
