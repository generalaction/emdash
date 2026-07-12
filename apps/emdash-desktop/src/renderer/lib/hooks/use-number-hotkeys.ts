import { useHotkey, type Hotkey } from '@tanstack/react-hotkeys';
import { useMemo } from 'react';
import { getNumberHotkeys } from '@shared/shortcuts';

/**
 * Debounce window for number-family hotkeys. Fires on the leading edge, then
 * swallows OS key-repeat and rapid re-presses so switching doesn't thrash.
 */
export const NUMBER_HOTKEY_DEBOUNCE_MS = 200;

// Shared across all number-family bindings (hook instances and forwarded
// webview events) so rapid presses are debounced app-wide.
let lastFiredAt = 0;

/**
 * Claims the debounce window for a number-hotkey press. Returns false when the
 * press falls inside the window and must be swallowed. `at` is compared on the
 * performance.now() clock (KeyboardEvent.timeStamp uses the same origin).
 */
export function claimNumberHotkey(at: number = performance.now()): boolean {
  if (at - lastFiredAt < NUMBER_HOTKEY_DEBOUNCE_MS) return false;
  lastFiredAt = at;
  return true;
}

/**
 * Binds a number-family base hotkey (e.g. 'Control+1') to digits 1–9 with the
 * same modifiers. `onSelect` receives the 0-based index. A null `base`
 * (disabled in settings) or a base without a trailing digit binds nothing.
 */
export function useNumberHotkeys(
  base: Hotkey | null,
  enabled: boolean,
  onSelect: (index: number) => void
): void {
  const hotkeys = useMemo(() => (base ? getNumberHotkeys(base) : null), [base]);
  const active = enabled && hotkeys !== null;

  const fire = (index: number) => (e: KeyboardEvent) => {
    e.preventDefault();
    // Event creation time, not handler time: rapid presses must be swallowed
    // even when a heavy render delays processing of the second event.
    if (!claimNumberHotkey(e.timeStamp)) return;
    onSelect(index);
  };

  const options = { enabled: active, conflictBehavior: 'allow' } as const;
  useHotkey((hotkeys?.[0] ?? '') as Hotkey, fire(0), options);
  useHotkey((hotkeys?.[1] ?? '') as Hotkey, fire(1), options);
  useHotkey((hotkeys?.[2] ?? '') as Hotkey, fire(2), options);
  useHotkey((hotkeys?.[3] ?? '') as Hotkey, fire(3), options);
  useHotkey((hotkeys?.[4] ?? '') as Hotkey, fire(4), options);
  useHotkey((hotkeys?.[5] ?? '') as Hotkey, fire(5), options);
  useHotkey((hotkeys?.[6] ?? '') as Hotkey, fire(6), options);
  useHotkey((hotkeys?.[7] ?? '') as Hotkey, fire(7), options);
  useHotkey((hotkeys?.[8] ?? '') as Hotkey, fire(8), options);
}
