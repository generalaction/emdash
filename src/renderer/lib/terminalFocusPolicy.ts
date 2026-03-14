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

  // Terminal elements (including xterm's hidden .xterm-helper-textarea) must
  // be checked first — they are technically editable elements but should
  // still allow terminal-to-terminal auto-focus on task/tab switches.
  if (active.closest(TERMINAL_FOCUS_SELECTORS)) return true;

  if (active.closest('[role="dialog"]')) return false;
  if (isEditableElement(active)) return false;

  // Focus is on a non-terminal control (button, tab, link, etc.) — preserve it.
  return false;
}
