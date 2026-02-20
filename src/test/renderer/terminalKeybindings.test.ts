import { describe, expect, it } from 'vitest';
import {
  CTRL_J_ASCII,
  shouldCopySelectionFromTerminal,
  shouldMapShiftEnterToCtrlJ,
  shouldPasteToTerminal,
  type KeyEventLike,
} from '../../renderer/terminal/terminalKeybindings';

describe('TerminalSessionManager - Shift+Enter to Ctrl+J mapping', () => {
  const makeEvent = (overrides: Partial<KeyEventLike> = {}): KeyEventLike => ({
    type: 'keydown',
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  });

  it('maps Shift+Enter to Ctrl+J only', () => {
    expect(shouldMapShiftEnterToCtrlJ(makeEvent({ shiftKey: true }))).toBe(true);
    expect(shouldMapShiftEnterToCtrlJ(makeEvent({ shiftKey: false }))).toBe(false);
    expect(shouldMapShiftEnterToCtrlJ(makeEvent({ shiftKey: true, ctrlKey: true }))).toBe(false);
    expect(shouldMapShiftEnterToCtrlJ(makeEvent({ shiftKey: true, metaKey: true }))).toBe(false);
    expect(shouldMapShiftEnterToCtrlJ(makeEvent({ shiftKey: true, altKey: true }))).toBe(false);
    expect(shouldMapShiftEnterToCtrlJ(makeEvent({ key: 'a', shiftKey: true }))).toBe(false);
    expect(shouldMapShiftEnterToCtrlJ(makeEvent({ type: 'keyup', shiftKey: true }))).toBe(false);
  });

  it('uses line feed for Ctrl+J', () => {
    expect(CTRL_J_ASCII).toBe('\n');
  });

  it('detects copy shortcuts with selection', () => {
    const withSelection = true;
    const withoutSelection = false;

    // macOS: Cmd+C should copy selected text
    expect(
      shouldCopySelectionFromTerminal(makeEvent({ key: 'c', metaKey: true }), true, withSelection)
    ).toBe(true);

    // non-macOS: Ctrl+C should copy selected text
    expect(
      shouldCopySelectionFromTerminal(makeEvent({ key: 'c', ctrlKey: true }), false, withSelection)
    ).toBe(true);

    // all platforms: Ctrl+Shift+C should copy selected text
    expect(
      shouldCopySelectionFromTerminal(
        makeEvent({ key: 'c', ctrlKey: true, shiftKey: true }),
        true,
        withSelection
      )
    ).toBe(true);
    expect(
      shouldCopySelectionFromTerminal(
        makeEvent({ key: 'c', ctrlKey: true, shiftKey: true }),
        false,
        withSelection
      )
    ).toBe(true);

    // no selection should never copy
    expect(
      shouldCopySelectionFromTerminal(
        makeEvent({ key: 'c', metaKey: true }),
        true,
        withoutSelection
      )
    ).toBe(false);
    expect(
      shouldCopySelectionFromTerminal(
        makeEvent({ key: 'c', ctrlKey: true }),
        false,
        withoutSelection
      )
    ).toBe(false);

    // modifier mismatch should not copy
    expect(
      shouldCopySelectionFromTerminal(
        makeEvent({ key: 'c', metaKey: true, shiftKey: true }),
        true,
        withSelection
      )
    ).toBe(false);
    expect(
      shouldCopySelectionFromTerminal(
        makeEvent({ key: 'c', altKey: true, ctrlKey: true }),
        false,
        withSelection
      )
    ).toBe(false);
  });

  it('detects Ctrl+Shift+V paste on Linux only', () => {
    const isMac = true;
    const isNotMac = false;

    // Ctrl+Shift+V on Linux should trigger paste
    expect(
      shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true, shiftKey: true }), isNotMac)
    ).toBe(true);

    // Ctrl+Shift+V on macOS should NOT trigger paste (macOS uses Cmd+V)
    expect(
      shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true, shiftKey: true }), isMac)
    ).toBe(false);

    // Ctrl+V alone should NOT trigger (that's SIGINT in terminals)
    expect(shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true }), isNotMac)).toBe(false);

    // Additional modifiers should NOT trigger
    expect(
      shouldPasteToTerminal(
        makeEvent({ key: 'v', ctrlKey: true, shiftKey: true, altKey: true }),
        isNotMac
      )
    ).toBe(false);
    expect(
      shouldPasteToTerminal(
        makeEvent({ key: 'v', ctrlKey: true, shiftKey: true, metaKey: true }),
        isNotMac
      )
    ).toBe(false);

    // Wrong key should NOT trigger
    expect(
      shouldPasteToTerminal(makeEvent({ key: 'c', ctrlKey: true, shiftKey: true }), isNotMac)
    ).toBe(false);

    // keyup should NOT trigger
    expect(
      shouldPasteToTerminal(
        makeEvent({ type: 'keyup', key: 'v', ctrlKey: true, shiftKey: true }),
        isNotMac
      )
    ).toBe(false);
  });
});
