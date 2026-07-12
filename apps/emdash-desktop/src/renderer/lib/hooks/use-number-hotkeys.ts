import { useHotkey, type Hotkey } from '@tanstack/react-hotkeys';
import { useMemo } from 'react';
import { getNumberHotkeys } from '@shared/shortcuts';

/**
 * Debounce window for number-family hotkeys. Fires on the leading edge, then
 * swallows OS key-repeat and rapid re-presses so switching doesn't thrash.
 */
export const NUMBER_HOTKEY_DEBOUNCE_MS = 200;

// Shared across all number-family bindings (hook instances and forwarded
// webview events) so key-repeat of one action is debounced app-wide while
// distinct actions stay responsive.
let lastClaimId = '';
let lastClaimAt = 0;

/**
 * Claims the debounce window for a number-hotkey press. Repeats of the SAME
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
 * Binds a number-family base hotkey (e.g. 'Control+1') to digits 1–9 with the
 * same modifiers. `onSelect` receives the 0-based index. A null `base`
 * (disabled in settings) or a base without a trailing digit binds nothing.
 * `family` scopes the debounce so repeats of one action are swallowed without
 * blocking other number shortcuts.
 */
export function useNumberHotkeys(
  base: Hotkey | null,
  family: 'tab' | 'task',
  enabled: boolean,
  onSelect: (index: number) => void
): void {
  const hotkeys = useMemo(() => (base ? getNumberHotkeys(base) : null), [base]);
  const active = enabled && hotkeys !== null;

  const fire = (index: number) => (e: KeyboardEvent) => {
    e.preventDefault();
    // Event creation time, not handler time: key-repeat must be swallowed
    // even when a heavy render delays processing of the repeated event.
    if (!claimNumberHotkey(`${family}:${index}`, e.timeStamp)) return;
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
