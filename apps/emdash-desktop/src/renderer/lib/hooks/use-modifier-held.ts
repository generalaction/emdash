import { useEffect, useState } from 'react';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import { events } from '@renderer/lib/ipc';
import type { AppSettings } from '@shared/core/app-settings';
import {
  numberShortcutChannel,
  numberShortcutModifierChannel,
  type NumberShortcutModifier,
} from '@shared/events/appEvents';
import { isMacLike, type ShortcutSettingsKey } from '@shared/shortcuts';

export type RevealModifier = NumberShortcutModifier;

/**
 * The modifier whose hold reveals number hints for a shortcut family: taken
 * from the first enabled binding among `keys`.
 */
export function getFamilyRevealModifier(
  keys: readonly ShortcutSettingsKey[],
  keyboard: AppSettings['keyboard'] | undefined
): RevealModifier | null {
  for (const key of keys) {
    const modifier = getHotkeyRevealModifier(getEffectiveHotkey(key, keyboard));
    if (modifier !== null) return modifier;
  }
  return null;
}

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
 * True while `key` has been held down for at least `delayMs`. Hints hide as
 * soon as another key is pressed, and reset when the modifier is released or
 * the window blurs.
 */
export function useModifierHeld(key: RevealModifier | null, delayMs = 250): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (key === null) return;
    let timer: number | null = null;
    let modifierDown = false;
    const hide = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      setHeld(false);
    };
    const cancel = () => {
      modifierDown = false;
      hide();
    };
    const start = () => {
      if (modifierDown) return;
      modifierDown = true;
      timer = window.setTimeout(() => setHeld(true), delayMs);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === key) {
        if (!e.repeat) start();
      } else if (modifierDown) {
        hide();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === key) cancel();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', cancel);
    const stopForwardedModifier = events.on(numberShortcutModifierChannel, (event) => {
      if (event.modifier === null) {
        cancel();
      } else if (event.modifier === key) {
        if (event.held) start();
        else cancel();
      }
    });
    const stopForwardedShortcut = events.on(numberShortcutChannel, () => {
      if (modifierDown) hide();
    });
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', cancel);
      stopForwardedModifier();
      stopForwardedShortcut();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [key, delayMs]);

  return key === null ? false : held;
}
