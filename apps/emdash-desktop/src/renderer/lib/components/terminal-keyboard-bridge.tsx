import { detectPlatform, normalizeHotkey } from '@tanstack/hotkeys';
import { useLayoutEffect, useMemo } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  APP_SHORTCUTS,
  getEffectiveHotkey,
  type ShortcutSettingsKey,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { dispatchMatchingHotkeys } from '@renderer/lib/hotkeys/dispatch-matching-hotkeys';

function isTerminalFocused(): boolean {
  return document.activeElement?.closest('.xterm') !== null;
}

/**
 * Fires the small allowlist of app shortcuts flagged `overrideTerminalFocus`
 * (e.g. the command palette) when an xterm terminal has focus.
 *
 * xterm.js maps Ctrl+<key> combinations to terminal control codes on
 * Windows/Linux and calls stopPropagation() on the keydown, so TanStack's
 * document-level (bubbling phase) listeners never see them — which is why
 * Ctrl+K does nothing from inside a terminal on Windows while Cmd+K works on
 * macOS (xterm lets Cmd combos through). This bridge listens at capture phase,
 * which runs before xterm's textarea handler, so it cannot be blocked by it.
 *
 * Only the flagged shortcuts are intercepted; every other key still reaches the
 * terminal so essential control keys (Ctrl+C, Ctrl+D, Ctrl+L, …) keep working.
 * When no terminal is focused the handler returns immediately and normal
 * TanStack bubbling-phase handling takes over unchanged.
 */
export function TerminalKeyboardBridge() {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const overrideHotkeys = useMemo(() => {
    const platform = detectPlatform();
    const next = new Set<string>();
    const shortcuts = Object.entries(APP_SHORTCUTS) as [
      ShortcutSettingsKey,
      (typeof APP_SHORTCUTS)[ShortcutSettingsKey],
    ][];

    for (const [key, def] of shortcuts) {
      if (!def.overrideTerminalFocus) continue;
      const hotkey = getEffectiveHotkey(key, keyboard);
      if (hotkey !== null) next.add(normalizeHotkey(hotkey, platform));
    }

    return next;
  }, [keyboard]);

  useLayoutEffect(() => {
    if (overrideHotkeys.size === 0) return;
    const platform = detectPlatform();

    const handler = (e: KeyboardEvent) => {
      if (!isTerminalFocused()) return;

      const handled = dispatchMatchingHotkeys(e, {
        dispatch: 'all',
        filter: (registration) =>
          overrideHotkeys.has(normalizeHotkey(registration.hotkey, platform)),
      });

      // Prevent the event from reaching xterm and skip the TanStack bubbling
      // listener, which would otherwise double-dispatch the same shortcut.
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };

    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [overrideHotkeys]);

  return null;
}
