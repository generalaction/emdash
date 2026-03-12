import { describe, expect, it } from 'vitest';
import { isTerminalExpandShortcut } from '../../renderer/lib/terminalShortcuts';

const makeEvent = (overrides: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({
    key: 't',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  }) as KeyboardEvent;

describe('isTerminalExpandShortcut', () => {
  // --- Positive cases (should trigger expand) ---

  it('returns true for Cmd+Shift+t on macOS (lowercase)', () => {
    expect(isTerminalExpandShortcut(makeEvent({ key: 't', metaKey: true, shiftKey: true }))).toBe(
      true
    );
  });

  it('returns true for Cmd+Shift+T on macOS (uppercase)', () => {
    expect(isTerminalExpandShortcut(makeEvent({ key: 'T', metaKey: true, shiftKey: true }))).toBe(
      true
    );
  });

  it('returns true for Ctrl+Shift+t on non-mac (lowercase)', () => {
    expect(isTerminalExpandShortcut(makeEvent({ key: 't', ctrlKey: true, shiftKey: true }))).toBe(
      true
    );
  });

  it('returns true for Ctrl+Shift+T on non-mac (uppercase)', () => {
    expect(isTerminalExpandShortcut(makeEvent({ key: 'T', ctrlKey: true, shiftKey: true }))).toBe(
      true
    );
  });

  it('returns true when both metaKey and ctrlKey are set with Shift+t', () => {
    expect(
      isTerminalExpandShortcut(
        makeEvent({ key: 't', metaKey: true, ctrlKey: true, shiftKey: true })
      )
    ).toBe(true);
  });

  // --- Negative cases (should NOT trigger expand) ---

  it('returns false when Shift is missing', () => {
    expect(isTerminalExpandShortcut(makeEvent({ key: 't', metaKey: true, shiftKey: false }))).toBe(
      false
    );
    expect(isTerminalExpandShortcut(makeEvent({ key: 't', ctrlKey: true, shiftKey: false }))).toBe(
      false
    );
  });

  it('returns false when neither metaKey nor ctrlKey is set', () => {
    expect(isTerminalExpandShortcut(makeEvent({ key: 't', shiftKey: true }))).toBe(false);
  });

  it('returns false for keys other than T', () => {
    expect(isTerminalExpandShortcut(makeEvent({ key: 'y', metaKey: true, shiftKey: true }))).toBe(
      false
    );
    expect(isTerminalExpandShortcut(makeEvent({ key: 'k', ctrlKey: true, shiftKey: true }))).toBe(
      false
    );
  });

  it('returns false for Enter key even with correct modifiers', () => {
    expect(
      isTerminalExpandShortcut(makeEvent({ key: 'Enter', metaKey: true, shiftKey: true }))
    ).toBe(false);
  });

  it('returns true even when altKey is also held (altKey is not filtered)', () => {
    expect(
      isTerminalExpandShortcut(makeEvent({ key: 't', metaKey: true, shiftKey: true, altKey: true }))
    ).toBe(true);
    expect(
      isTerminalExpandShortcut(makeEvent({ key: 't', ctrlKey: true, shiftKey: true, altKey: true }))
    ).toBe(true);
  });
});
