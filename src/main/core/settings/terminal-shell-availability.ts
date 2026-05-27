import fs from 'node:fs';
import path from 'node:path';
import {
  TERMINAL_SHELL_IDS,
  type TerminalShellAvailability,
  type TerminalShellId,
} from '@shared/terminal-settings';

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveLocalShellPath(shell: TerminalShellId): string | undefined {
  if (shell === 'auto') return undefined;
  if (process.platform === 'win32') return undefined;

  const pathDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, shell);
    if (isExecutable(candidate)) return candidate;
  }

  return undefined;
}

export function getTerminalShellAvailability(): TerminalShellAvailability[] {
  return TERMINAL_SHELL_IDS.map((shell) => {
    if (shell === 'auto') return { shell, available: true };
    const shellPath = resolveLocalShellPath(shell);
    return { shell, available: shellPath !== undefined };
  });
}
