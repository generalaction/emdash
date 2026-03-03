/**
 * Strip ANSI escape codes from terminal output.
 * Handles CSI sequences, OSC sequences, and generic escape codes.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(
    /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[\x20-\x2F]*[\x40-\x7E]/g,
    ''
  );
}

/**
 * Extract the last N lines from terminal output text.
 */
export function extractLastLines(text: string, n: number): string {
  const lines = text.split('\n');
  return lines.slice(-n).join('\n');
}
