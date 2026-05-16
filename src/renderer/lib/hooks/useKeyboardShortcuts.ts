import type { Hotkey } from '@tanstack/react-hotkeys';
import { APP_SHORTCUTS, resolveDefaultHotkey, type ShortcutSettingsKey } from '@shared/shortcuts';

export type { AppShortcutDef, ShortcutSettingsKey } from '@shared/shortcuts';
export { APP_SHORTCUTS, resolveDefaultHotkey } from '@shared/shortcuts';

type ShortcutOverrides = Partial<Record<ShortcutSettingsKey, string | null>>;

/**
 * Returns the currently assigned hotkey for an action.
 * - `undefined` override -> falls back to default
 * - `null` override -> unassigned (disabled)
 * - no `defaultHotkey` and no override -> `null` (not bound)
 */
export function getEffectiveHotkey(
  key: ShortcutSettingsKey,
  custom?: ShortcutOverrides
): Hotkey | null {
  const configured = custom?.[key];
  if (configured === null) return null;
  const resolved = configured ?? resolveDefaultHotkey(APP_SHORTCUTS[key]);
  return resolved != null ? (resolved as Hotkey) : null;
}

/**
 * Always returns a valid hotkey string for hook registration.
 * Pair this with `getEffectiveHotkey(...) !== null` in `enabled`.
 */
export function getHotkeyRegistration(
  key: ShortcutSettingsKey,
  custom?: ShortcutOverrides
): Hotkey {
  return (getEffectiveHotkey(key, custom) ??
    resolveDefaultHotkey(APP_SHORTCUTS[key]) ??
    '') as Hotkey;
}
