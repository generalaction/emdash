import { describe, expect, it } from 'vitest';
import { isTerminalExpandShortcut } from '../../renderer/lib/terminalShortcuts';

describe('isTerminalExpandShortcut', () => {
  it('returns true for Cmd+Shift+T on macOS', () => {
    const event = {
      key: 't',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    } as KeyboardEvent;

    expect(isTerminalExpandShortcut(event)).toBe(true);
  });

  it('returns true for Ctrl+Shift+T on non-mac platforms', () => {
    const event = {
      key: 'T',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
    } as KeyboardEvent;

    expect(isTerminalExpandShortcut(event)).toBe(true);
  });

  it('returns false for missing Shift', () => {
    const event = {
      key: 't',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    } as KeyboardEvent;

    expect(isTerminalExpandShortcut(event)).toBe(false);
  });

  it('returns false for keys other than T', () => {
    const event = {
      key: 'y',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
    } as KeyboardEvent;

    expect(isTerminalExpandShortcut(event)).toBe(false);
  });
});
