import { useEffect, useState } from 'react';
import { isMacLike } from '@shared/shortcuts';

export type RevealModifier = 'Meta' | 'Control' | 'Alt' | 'Shift';

/**
 * The modifier key whose hold should reveal number-shortcut hints for a
 * hotkey base like 'Control+1' or 'Mod+1'. Null when the hotkey is unset.
 */
export function getHotkeyRevealModifier(hotkey: string | null): RevealModifier | null {
  if (!hotkey) return null;
  const parts = hotkey.split('+').map((p) => p.trim().toLowerCase());
  const has = (...names: string[]) => names.some((n) => parts.includes(n));
  if (has('mod')) return isMacLike() ? 'Meta' : 'Control';
  if (has('meta', 'cmd', 'command')) return 'Meta';
  if (has('ctrl', 'control')) return 'Control';
  if (has('alt', 'option')) return 'Alt';
  if (has('shift')) return 'Shift';
  return null;
}

/**
 * True while `key` has been held down for at least `delayMs`, until it is
 * released or the window blurs. Chord presses while held (e.g. the digit of a
 * number shortcut) do NOT reset the state, so hints stay visible across
 * consecutive jumps within one hold.
 */
export function useModifierHeld(key: RevealModifier | null, delayMs = 250): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (key === null) return;
    let timer: number | null = null;
    const cancel = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      setHeld(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // timer doubles as the "this hold is already tracked" sentinel; it stays
      // set after firing until keyup/blur cancels.
      if (e.key !== key || e.repeat || timer !== null) return;
      timer = window.setTimeout(() => setHeld(true), delayMs);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === key) cancel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', cancel);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [key, delayMs]);

  return key === null ? false : held;
}
