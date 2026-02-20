export type KeyEventLike = {
  type: string;
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
};

// Ctrl+J sends line feed (LF) to the PTY, which CLI agents interpret as a newline
export const CTRL_J_ASCII = '\x0A';

export function shouldMapShiftEnterToCtrlJ(event: KeyEventLike): boolean {
  return (
    event.type === 'keydown' &&
    event.key === 'Enter' &&
    event.shiftKey === true &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  );
}

export function shouldCopySelectionFromTerminal(
  event: KeyEventLike,
  isMacPlatform: boolean,
  hasSelection: boolean
): boolean {
  if (!hasSelection) return false;
  if (event.type !== 'keydown') return false;
  if (event.key.toLowerCase() !== 'c') return false;

  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  const shift = event.shiftKey === true;

  // Ctrl+Shift+C should copy on all platforms
  if (ctrl && shift && !meta && !alt) return true;

  // Platform-specific default copy shortcuts
  if (isMacPlatform) {
    return meta && !ctrl && !shift && !alt;
  }

  return ctrl && !meta && !shift && !alt;
}

/**
 * Detect Ctrl+Shift+V paste shortcut on Linux.
 * Linux terminals use Ctrl+Shift+V as the standard paste shortcut,
 * unlike Windows/macOS which use Ctrl+V/Cmd+V.
 */
export function shouldPasteToTerminal(event: KeyEventLike, isMacPlatform: boolean): boolean {
  if (event.type !== 'keydown') return false;
  if (event.key.toLowerCase() !== 'v') return false;

  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  const shift = event.shiftKey === true;

  // Ctrl+Shift+V is the standard paste shortcut in Linux terminals
  // Only apply on non-Mac platforms (Linux/Windows with Linux-style terminals)
  if (!isMacPlatform && ctrl && shift && !meta && !alt) {
    return true;
  }

  return false;
}
