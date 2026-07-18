import type { ChordKeyboardEventLike } from '../api/chord';
import type { KeybindingOptions } from '../api/define-keybinding';

export interface KeybindingFocusContext {
  readonly textInputFocused: boolean;
}

interface MatchableTarget {
  matches(selector: string): boolean;
}

function hasMatches(value: unknown): value is MatchableTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    'matches' in value &&
    typeof value.matches === 'function'
  );
}

export function isTextInputFocusTarget(target: unknown): boolean {
  return (
    hasMatches(target) &&
    target.matches('input,select,textarea,[contenteditable]:not([contenteditable="false"])')
  );
}

export function shouldIgnoreForOptions(
  event: ChordKeyboardEventLike,
  options: KeybindingOptions | undefined,
  focus: KeybindingFocusContext
): boolean {
  if (event.isComposing) return true;
  if (event.repeat && !options?.allowRepeat) return true;
  return Boolean(options?.ignoreWhenTextInputFocused && focus.textInputFocused);
}
