export const TERMINAL_FONT_SIZE_DEFAULT = 13;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;

export const TERMINAL_SHELL_IDS = [
  'auto',
  'bash',
  'csh',
  'dash',
  'ksh',
  'sh',
  'tcsh',
  'zsh',
] as const;
export type TerminalShellId = (typeof TERMINAL_SHELL_IDS)[number];

export type TerminalShellAvailability = {
  shell: TerminalShellId;
  available: boolean;
};

const BASIC_INTERACTIVE_SHELLS = new Set(['csh', 'dash', 'sh', 'tcsh']);
const C_SHELLS = new Set(['csh', 'tcsh']);

export function terminalShellBasename(shell: string): string {
  return shell.split('/').pop() ?? '';
}

export function isCshShell(shell: string): boolean {
  return C_SHELLS.has(terminalShellBasename(shell));
}

export function terminalInteractiveShellArgs(shell: string): string[] {
  return BASIC_INTERACTIVE_SHELLS.has(terminalShellBasename(shell)) ? ['-i'] : ['-il'];
}

export function terminalShellCommandFlag(shell: string): '-c' | '-lc' {
  return BASIC_INTERACTIVE_SHELLS.has(terminalShellBasename(shell)) ? '-c' : '-lc';
}

export function terminalShellEnvCaptureFlag(shell: string): '-ic' | '-ilc' {
  return BASIC_INTERACTIVE_SHELLS.has(terminalShellBasename(shell)) ? '-ic' : '-ilc';
}
