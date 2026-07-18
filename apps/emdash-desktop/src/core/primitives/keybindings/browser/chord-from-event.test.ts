import { describe, expect, it } from 'vitest';
import type { ChordKeyboardEventLike } from '../api/chord';
import { isTextInputFocusTarget, shouldIgnoreForOptions } from './chord-from-event';

function event(overrides: Partial<ChordKeyboardEventLike> = {}): ChordKeyboardEventLike {
  return {
    key: 'k',
    code: 'KeyK',
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...overrides,
  };
}

describe('shouldIgnoreForOptions', () => {
  it('always ignores composition events', () => {
    expect(
      shouldIgnoreForOptions(event({ isComposing: true }), undefined, {
        textInputFocused: false,
      })
    ).toBe(true);
  });

  it('ignores repeat unless the binding explicitly allows it', () => {
    expect(
      shouldIgnoreForOptions(event({ repeat: true }), undefined, {
        textInputFocused: false,
      })
    ).toBe(true);
    expect(
      shouldIgnoreForOptions(
        event({ repeat: true }),
        { allowRepeat: true },
        {
          textInputFocused: false,
        }
      )
    ).toBe(false);
  });

  it('applies text-input gating per binding', () => {
    expect(
      shouldIgnoreForOptions(
        event(),
        { ignoreWhenTextInputFocused: true },
        {
          textInputFocused: true,
        }
      )
    ).toBe(true);
    expect(
      shouldIgnoreForOptions(event(), undefined, {
        textInputFocused: true,
      })
    ).toBe(false);
  });
});

describe('isTextInputFocusTarget', () => {
  it('recognizes form controls and editable elements through a structural target', () => {
    const input = { matches: (selector: string) => selector.includes('input') };
    const editable = {
      matches: (selector: string) => selector.includes('[contenteditable]'),
    };

    expect(isTextInputFocusTarget(input)).toBe(true);
    expect(isTextInputFocusTarget(editable)).toBe(true);
  });

  it('returns false for non-elements and ordinary elements', () => {
    expect(isTextInputFocusTarget(null)).toBe(false);
    expect(isTextInputFocusTarget({})).toBe(false);
    expect(isTextInputFocusTarget({ matches: () => false })).toBe(false);
  });
});
