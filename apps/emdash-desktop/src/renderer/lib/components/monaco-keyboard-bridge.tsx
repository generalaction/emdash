import { useEffect, useMemo } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  APP_SHORTCUTS,
  getEffectiveHotkey,
  type ShortcutSettingsKey,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
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
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const ignoredHotkeys = useMemo(() => {
    const next = new Set<string>();
    const shortcuts = Object.entries(APP_SHORTCUTS) as [
      ShortcutSettingsKey,
      (typeof APP_SHORTCUTS)[ShortcutSettingsKey],
    ][];

    for (const [key, def] of shortcuts) {
      if (!def.ignoreWhenMonacoFocused) continue;
      const hotkey = getEffectiveHotkey(key, keyboard);
      if (hotkey !== null) next.add(hotkey);
    }

    return next;
  }, [keyboard]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isMonacoFocused()) return;

      const handled = dispatchMatchingHotkeys(e, {
        filter: (registration) => !ignoredHotkeys.has(registration.hotkey),
      });

      // Prevent the event from reaching Monaco and skip the TanStack bubbling
      // listener (which would otherwise double-dispatch the same shortcut).
      if (handled) e.stopPropagation();
    };

    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [ignoredHotkeys]);

  return null;
}
