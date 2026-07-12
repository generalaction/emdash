import { useHotkey } from '@tanstack/react-hotkeys';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import type { AppSettings } from '@shared/core/app-settings';
import { TAB_BY_NUMBER_KEYS, TASK_BY_NUMBER_KEYS } from '@shared/shortcuts';

/**
 * Debounce window for number shortcuts. Fires on the leading edge, then
 * swallows OS key-repeat and rapid re-presses of the SAME action so switching
 * doesn't thrash; distinct actions stay responsive.
 */
export const NUMBER_HOTKEY_DEBOUNCE_MS = 200;

// Shared across all number bindings (hook instances and forwarded webview
// events) so key-repeat of one action is debounced app-wide.
let lastClaimId = '';
let lastClaimAt = 0;

/**
 * Claims the debounce window for a number-shortcut press. Repeats of the SAME
 * action (same `id`) inside the window are swallowed; a different action
 * always fires. `at` is compared on the performance.now() clock
 * (KeyboardEvent.timeStamp uses the same origin); the absolute delta keeps a
 * clock discrepancy from wedging the window shut.
 */
export function claimNumberHotkey(id: string, at: number = performance.now()): boolean {
  if (id === lastClaimId && Math.abs(at - lastClaimAt) < NUMBER_HOTKEY_DEBOUNCE_MS) return false;
  lastClaimId = id;
  lastClaimAt = at;
  return true;
}

/**
 * Binds the nine individually-configurable jump shortcuts of a family (tab1-9
 * or task1-9). `onSelect` receives the 0-based index. Entries disabled in
 * settings bind nothing.
 */
export function useNumberHotkeys(
  family: 'tab' | 'task',
  keyboard: AppSettings['keyboard'] | undefined,
  enabled: boolean,
  onSelect: (index: number) => void
): void {
  const keys = family === 'tab' ? TAB_BY_NUMBER_KEYS : TASK_BY_NUMBER_KEYS;

  const fire = (index: number) => (e: KeyboardEvent) => {
    e.preventDefault();
    // Event creation time, not handler time: key-repeat must be swallowed
    // even when a heavy render delays processing of the repeated event.
    if (!claimNumberHotkey(`${family}:${index}`, e.timeStamp)) return;
    onSelect(index);
  };

  const options = (index: number) =>
    ({
      enabled: enabled && getEffectiveHotkey(keys[index], keyboard) !== null,
      conflictBehavior: 'allow',
    }) as const;

  useHotkey(getHotkeyRegistration(keys[0], keyboard), fire(0), options(0));
  useHotkey(getHotkeyRegistration(keys[1], keyboard), fire(1), options(1));
  useHotkey(getHotkeyRegistration(keys[2], keyboard), fire(2), options(2));
  useHotkey(getHotkeyRegistration(keys[3], keyboard), fire(3), options(3));
  useHotkey(getHotkeyRegistration(keys[4], keyboard), fire(4), options(4));
  useHotkey(getHotkeyRegistration(keys[5], keyboard), fire(5), options(5));
  useHotkey(getHotkeyRegistration(keys[6], keyboard), fire(6), options(6));
  useHotkey(getHotkeyRegistration(keys[7], keyboard), fire(7), options(7));
  useHotkey(getHotkeyRegistration(keys[8], keyboard), fire(8), options(8));
}
