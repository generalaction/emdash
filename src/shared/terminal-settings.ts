export const TERMINAL_FONT_SIZE_DEFAULT = 13;
export const TERMINAL_FONT_SIZE_MIN = 8;
export const TERMINAL_FONT_SIZE_MAX = 32;

export const TERMINAL_SHELL_IDS = [
  'auto',
  'bash',
  'cmd',
  'csh',
  'dash',
  'ksh',
  'powershell',
  'pwsh',
  'sh',
  'tcsh',
  'zsh',
] as const;

export type TerminalShellId = (typeof TERMINAL_SHELL_IDS)[number];
export type ExplicitTerminalShellId = Exclude<TerminalShellId, 'auto'>;
export type TerminalShellFamily = 'posix' | 'csh' | 'windows-cmd' | 'powershell';

export type TerminalShellAvailability = {
  shell: TerminalShellId;
  displayName: string;
  available: boolean;
  reason?: string;
};

const CSH_SHELLS = new Set<string>(['csh', 'tcsh']);
const BASIC_INTERACTIVE_SHELLS = new Set<string>(['csh', 'dash', 'sh', 'tcsh']);

export function terminalShellBasename(shell: string): string {
  return shell.split(/[\\/]/).pop()?.toLowerCase() ?? '';
}

export function isExplicitTerminalShellId(shell: string): shell is ExplicitTerminalShellId {
  return TERMINAL_SHELL_IDS.includes(shell as TerminalShellId) && shell !== 'auto';
}

export function terminalShellDisplayName(shell: TerminalShellId): string {
  switch (shell) {
    case 'auto':
      return 'Auto';
    case 'cmd':
      return 'cmd';
    case 'powershell':
      return 'powershell';
    case 'pwsh':
      return 'pwsh';
    default:
      return shell;
  }
}

export function isCshShell(shell: string): boolean {
  return CSH_SHELLS.has(terminalShellBasename(shell));
}

export function terminalShellFamily(shell: string): TerminalShellFamily {
  const base = terminalShellBasename(shell);
  if (base === 'cmd' || base === 'cmd.exe') return 'windows-cmd';
  if (base === 'powershell' || base === 'powershell.exe' || base === 'pwsh' || base === 'pwsh.exe')
    return 'powershell';
  if (CSH_SHELLS.has(base)) return 'csh';
  return 'posix';
}

export function terminalInteractiveShellArgs(shell: string): string[] {
  const family = terminalShellFamily(shell);
  if (family === 'windows-cmd' || family === 'powershell') return [];
  return BASIC_INTERACTIVE_SHELLS.has(terminalShellBasename(shell)) ? ['-i'] : ['-il'];
}

export function terminalCommandArgs(shell: string): string[] {
  switch (terminalShellFamily(shell)) {
    case 'windows-cmd':
      return ['/d', '/s', '/c'];
    case 'powershell':
      return ['-NoProfile', '-Command'];
    case 'posix':
    case 'csh':
      return BASIC_INTERACTIVE_SHELLS.has(terminalShellBasename(shell)) ? ['-c'] : ['-lc'];
  }
}

export function terminalEnvCaptureArgs(shell: string): string[] | undefined {
  switch (terminalShellFamily(shell)) {
    case 'csh':
      return ['-i', '-c'];
    case 'posix':
      return BASIC_INTERACTIVE_SHELLS.has(terminalShellBasename(shell)) ? ['-ic'] : ['-ilc'];
    case 'windows-cmd':
    case 'powershell':
      return undefined;
  }
}
