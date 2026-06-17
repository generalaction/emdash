import { useEffect } from 'react';
import { dispatchMatchingHotkeys } from '@renderer/lib/hotkeys/dispatch-matching-hotkeys';

function isMonacoFocused(): boolean {
  return document.activeElement?.closest('.monaco-editor') !== null;
}

/**
 * Intercepts keyboard events at capture phase and fires matching TanStack hotkey
 * registrations when Monaco editor has focus.
 *
 * Monaco calls stopPropagation() on keydown events, preventing them from reaching
 * TanStack's document-level listeners (bubbling phase). This bridge uses capture
 * phase, which runs before Monaco's handlers, so it cannot be blocked by them.
 *
 * When Monaco is not focused the handler returns immediately and normal TanStack
 * bubbling-phase handling takes over unchanged.
 */
export function MonacoKeyboardBridge() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isMonacoFocused()) return;

      const handled = dispatchMatchingHotkeys(e);

      // Prevent the event from reaching Monaco and skip the TanStack bubbling
      // listener (which would otherwise double-dispatch the same shortcut).
      if (handled) e.stopPropagation();
    };

    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, []);

  return null;
}
