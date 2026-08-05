import type { HotkeyCallback } from '@tanstack/hotkeys';
import { useHotkey } from '@tanstack/react-hotkeys';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { dispatchMatchingHotkeys } from '@renderer/lib/hotkeys/dispatch-matching-hotkeys';
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
const lastClaimAtById = new Map<string, number>();
const numberHotkeyCallbacks = new WeakSet<HotkeyCallback>();

/**
 * Claims the debounce window for a number-shortcut press. Repeats of the SAME
 * action (same `id`) inside the window are swallowed; a different action
 * always fires. `at` is compared on the performance.now() clock
 * (KeyboardEvent.timeStamp uses the same origin); the absolute delta keeps a
 * clock discrepancy from wedging the window shut.
 */
export function claimNumberHotkey(id: string, at: number = performance.now()): boolean {
  const lastClaimAt = lastClaimAtById.get(id);
  if (lastClaimAt !== undefined && Math.abs(at - lastClaimAt) < NUMBER_HOTKEY_DEBOUNCE_MS) {
    return false;
  }
  lastClaimAtById.set(id, at);
  return true;
}

/**
 * Dispatches only number-navigation registrations from widgets such as xterm
 * that consume keyboard events before they reach the document listener.
 */
export function dispatchNumberHotkey(event: KeyboardEvent): boolean {
  if (event.type !== 'keydown') return false;
  return dispatchMatchingHotkeys(event, {
    filter: (registration) => numberHotkeyCallbacks.has(registration.callback),
  });
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

  const fire = (index: number): HotkeyCallback => {
    const callback: HotkeyCallback = (event) => {
      event.preventDefault();
      // Event creation time, not handler time: key-repeat must be swallowed
      // even when a heavy render delays processing of the repeated event.
      if (!claimNumberHotkey(`${family}:${index}`, event.timeStamp)) return;
      onSelect(index);
    };
    numberHotkeyCallbacks.add(callback);
    return callback;
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
