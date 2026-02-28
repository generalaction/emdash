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

/**
 * Returns the terminal escape sequence for a macOS keybinding, or null if no mapping.
 * Translates Cmd/Opt key combos into readline-compatible sequences that xterm.js
 * doesn't handle natively in Electron.
 */
export function getMacKeybindingSequence(event: KeyEventLike): string | null {
  if (event.type !== 'keydown') return null;

  const meta = event.metaKey === true;
  const alt = event.altKey === true;
  const ctrl = event.ctrlKey === true;
  const shift = event.shiftKey === true;

  // Cmd keybindings (no Ctrl, no Alt)
  if (meta && !ctrl && !alt) {
    if (!shift) {
      switch (event.key) {
        case 'ArrowLeft':
          return '\x01'; // Ctrl+A (beginning-of-line)
        case 'ArrowRight':
          return '\x05'; // Ctrl+E (end-of-line)
        case 'Backspace':
          return '\x15'; // Ctrl+U (unix-line-discard)
        case 'Delete':
          return '\x0b'; // Ctrl+K (kill-line forward)
      }
    } else {
      switch (event.key) {
        case 'ArrowLeft':
          return '\x1b[1;2H'; // Shift+Home (select to line start)
        case 'ArrowRight':
          return '\x1b[1;2F'; // Shift+End (select to line end)
      }
    }
  }

  // Opt keybindings (no Ctrl, no Cmd)
  if (alt && !ctrl && !meta) {
    if (!shift) {
      switch (event.key) {
        case 'ArrowLeft':
          return '\x1bb'; // ESC b (backward-word)
        case 'ArrowRight':
          return '\x1bf'; // ESC f (forward-word)
        case 'Backspace':
          return '\x1b\x7f'; // ESC DEL (backward-kill-word)
        case 'Delete':
          return '\x1bd'; // ESC d (kill-word forward)
      }
    } else {
      switch (event.key) {
        case 'ArrowLeft':
          return '\x1b[1;4D'; // Shift+Alt+Left (select word backward)
        case 'ArrowRight':
          return '\x1b[1;4C'; // Shift+Alt+Right (select word forward)
      }
    }
  }

  return null;
}
