import { detectPlatform, getHotkeyManager, matchesKeyboardEvent } from '@tanstack/hotkeys';
import { useEffect } from 'react';

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
    const platform = detectPlatform();

    const handler = (e: KeyboardEvent) => {
      if (!isMonacoFocused()) return;

      const manager = getHotkeyManager();
      let handled = false;

      for (const [, registration] of manager.registrations.state) {
        if (!registration.options.enabled) continue;
        if (matchesKeyboardEvent(e, registration.parsedHotkey, platform)) {
          if (registration.options.preventDefault) e.preventDefault();
          registration.callback(e, {
            hotkey: registration.hotkey,
            parsedHotkey: registration.parsedHotkey,
          });
          handled = true;
          // No break — conflictBehavior: 'allow' keys (tabClose, tabNext, tabPrev)
          // legitimately have multiple registrations for the same key.
        }
      }

      // Prevent the event from reaching Monaco and skip the TanStack bubbling
      // listener (which would otherwise double-dispatch the same shortcut).
      if (handled) e.stopPropagation();
    };

    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, []);

  return null;
}
