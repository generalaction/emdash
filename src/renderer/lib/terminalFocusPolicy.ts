const TERMINAL_FOCUS_SELECTORS = [
  '[data-terminal-container]',
  '.xterm',
  '.xterm-helper-textarea',
  '[data-expanded-terminal="true"]',
].join(',');

function isEditableElement(element: HTMLElement): boolean {
  const tagName = element.tagName;
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    element.isContentEditable
  );
}

export function shouldAllowTerminalAutoFocus(): boolean {
  if (typeof document === 'undefined') return false;

  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return true;

  if (active.closest('[role="dialog"]')) return false;
  if (isEditableElement(active)) return false;

  // If focus is currently on any non-terminal control (buttons, tabs, etc.),
  // preserve that focus instead of stealing it back to the terminal.
  return Boolean(active.closest(TERMINAL_FOCUS_SELECTORS));
}
