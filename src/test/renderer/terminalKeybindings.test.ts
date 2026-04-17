import { describe, expect, it } from 'vitest';
import {
  CTRL_J_ASCII,
  CTRL_U_ASCII,
  shouldCopySelectionFromTerminal,
  shouldKillLineFromTerminal,
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

  it('detects paste shortcuts by platform', () => {
    const isMac = true;
    const isNotMac = false;
    const isWin = true;
    const isNotWin = false;

    // Linux: Ctrl+Shift+V
    expect(
      shouldPasteToTerminal(
        makeEvent({ key: 'v', ctrlKey: true, shiftKey: true }),
        isNotMac,
        isNotWin
      )
    ).toBe(true);

    // Linux: Ctrl+V must not paste (reserved for TTY)
    expect(shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true }), isNotMac, isNotWin)).toBe(
      false
    );

    // Windows: Ctrl+V and Ctrl+Shift+V
    expect(shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true }), isNotMac, isWin)).toBe(
      true
    );
    expect(
      shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true, shiftKey: true }), isNotMac, isWin)
    ).toBe(true);

    // macOS: no match (Cmd+V elsewhere)
    expect(
      shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true, shiftKey: true }), isMac, isNotWin)
    ).toBe(false);

    // Additional modifiers should NOT trigger
    expect(
      shouldPasteToTerminal(
        makeEvent({ key: 'v', ctrlKey: true, shiftKey: true, altKey: true }),
        isNotMac,
        isNotWin
      )
    ).toBe(false);
    expect(
      shouldPasteToTerminal(
        makeEvent({ key: 'v', ctrlKey: true, shiftKey: true, metaKey: true }),
        isNotMac,
        isNotWin
      )
    ).toBe(false);

    expect(
      shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true, altKey: true }), isNotMac, isWin)
    ).toBe(false);

    // Wrong key should NOT trigger
    expect(
      shouldPasteToTerminal(
        makeEvent({ key: 'c', ctrlKey: true, shiftKey: true }),
        isNotMac,
        isNotWin
      )
    ).toBe(false);

    // keyup should NOT trigger
    expect(
      shouldPasteToTerminal(
        makeEvent({ type: 'keyup', key: 'v', ctrlKey: true, shiftKey: true }),
        isNotMac,
        isNotWin
      )
    ).toBe(false);
  });

  it('uses Ctrl+U for kill-line', () => {
    expect(CTRL_U_ASCII).toBe('\x15');
  });

  it('detects Cmd+Backspace on macOS only', () => {
    const isMac = true;
    const isNotMac = false;

    // Cmd+Backspace on macOS should trigger
    expect(shouldKillLineFromTerminal(makeEvent({ key: 'Backspace', metaKey: true }), isMac)).toBe(
      true
    );

    // Cmd+Backspace on Linux/Windows should NOT trigger
    expect(
      shouldKillLineFromTerminal(makeEvent({ key: 'Backspace', metaKey: true }), isNotMac)
    ).toBe(false);

    // Ctrl+Backspace should NOT trigger on any platform
    expect(shouldKillLineFromTerminal(makeEvent({ key: 'Backspace', ctrlKey: true }), isMac)).toBe(
      false
    );
    expect(
      shouldKillLineFromTerminal(makeEvent({ key: 'Backspace', ctrlKey: true }), isNotMac)
    ).toBe(false);

    // Additional modifiers should NOT trigger
    expect(
      shouldKillLineFromTerminal(
        makeEvent({ key: 'Backspace', metaKey: true, shiftKey: true }),
        isMac
      )
    ).toBe(false);
    expect(
      shouldKillLineFromTerminal(
        makeEvent({ key: 'Backspace', metaKey: true, altKey: true }),
        isMac
      )
    ).toBe(false);

    // Wrong key should NOT trigger
    expect(shouldKillLineFromTerminal(makeEvent({ key: 'Delete', metaKey: true }), isMac)).toBe(
      false
    );

    // keyup should NOT trigger
    expect(
      shouldKillLineFromTerminal(
        makeEvent({ type: 'keyup', key: 'Backspace', metaKey: true }),
        isMac
      )
    ).toBe(false);
  });
});
