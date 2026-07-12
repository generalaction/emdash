import { useHotkey, type Hotkey } from '@tanstack/react-hotkeys';
import { useMemo, useRef } from 'react';
import { getNumberHotkeys } from '@shared/shortcuts';

/**
 * Debounce window for number-family hotkeys. Fires on the leading edge, then
 * swallows OS key-repeat and rapid re-presses so switching doesn't thrash.
 */
export const NUMBER_HOTKEY_DEBOUNCE_MS = 200;

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
  const lastFiredAtRef = useRef(0);
  const active = enabled && hotkeys !== null;

  const fire = (index: number) => (e: KeyboardEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (now - lastFiredAtRef.current < NUMBER_HOTKEY_DEBOUNCE_MS) return;
    lastFiredAtRef.current = now;
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
