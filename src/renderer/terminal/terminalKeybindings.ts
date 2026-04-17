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

// Ctrl+U (unix-line-discard) kills from cursor to beginning of line
export const CTRL_U_ASCII = '\x15';

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
 * Detect Cmd+Backspace on macOS for "kill to beginning of line".
 * We send Ctrl+U (\x15) to the PTY, which readline-compatible shells
 * and most CLI agents interpret as unix-line-discard.
 *
 * Only intercepted on macOS — on Linux/Windows, Ctrl+U already reaches
 * the PTY natively for the same effect.
 */
export function shouldKillLineFromTerminal(event: KeyEventLike, isMacPlatform: boolean): boolean {
  if (!isMacPlatform) return false;
  if (event.type !== 'keydown') return false;
  if (event.key !== 'Backspace') return false;

  return event.metaKey === true && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * Paste shortcut for the embedded terminal: Linux uses Ctrl+Shift+V; Windows uses Ctrl+V;
 * macOS uses Cmd+V and is left to the browser/Electron default.
 */
export function shouldPasteToTerminal(
  event: KeyEventLike,
  isMacPlatform: boolean,
  isWindowsPlatform: boolean
): boolean {
  if (event.type !== 'keydown') return false;
  if (event.key.toLowerCase() !== 'v') return false;

  const ctrl = event.ctrlKey === true;
  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  const shift = event.shiftKey === true;

  if (isMacPlatform) return false;

  if (isWindowsPlatform) {
    return ctrl && !meta && !alt;
  }

  return ctrl && shift && !meta && !alt;
}
