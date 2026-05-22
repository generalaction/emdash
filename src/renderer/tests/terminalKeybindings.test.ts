import { describe, expect, it } from 'vitest';
import {
  CTRL_J_ASCII,
  CTRL_U_ASCII,
  shouldCopySelectionFromTerminal,
  shouldHandleInterruptFromTerminal,
  shouldKillLineFromTerminal,
  shouldMapShiftEnterToCtrlJ,
  shouldPasteToTerminal,
  type KeyEventLike,
} from '@renderer/lib/pty/pty-keybindings';

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

  it('detects paste shortcuts per platform', () => {
    const mac: [boolean, boolean] = [true, false];
    const win: [boolean, boolean] = [false, true];
    const linux: [boolean, boolean] = [false, false];

    // Ctrl+Shift+V triggers paste on Linux and Windows
    expect(
      shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true, shiftKey: true }), ...linux)
    ).toBe(true);
    expect(
      shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true, shiftKey: true }), ...win)
    ).toBe(true);

    // Ctrl+Shift+V on macOS should NOT trigger paste (macOS uses Cmd+V via menu)
    expect(
      shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true, shiftKey: true }), ...mac)
    ).toBe(false);

    // Ctrl+V triggers paste on Windows (native Windows shortcut)
    expect(shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true }), ...win)).toBe(true);

    // Ctrl+V on Linux is readline's quoted-insert, not paste
    expect(shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true }), ...linux)).toBe(false);

    // Ctrl+V on macOS should NOT trigger (routed via Cmd+V menu accelerator)
    expect(shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true }), ...mac)).toBe(false);

    // Additional modifiers should NOT trigger
    expect(
      shouldPasteToTerminal(
        makeEvent({ key: 'v', ctrlKey: true, shiftKey: true, altKey: true }),
        ...linux
      )
    ).toBe(false);
    expect(
      shouldPasteToTerminal(
        makeEvent({ key: 'v', ctrlKey: true, shiftKey: true, metaKey: true }),
        ...linux
      )
    ).toBe(false);
    expect(
      shouldPasteToTerminal(makeEvent({ key: 'v', ctrlKey: true, altKey: true }), ...win)
    ).toBe(false);

    // Wrong key should NOT trigger
    expect(
      shouldPasteToTerminal(makeEvent({ key: 'c', ctrlKey: true, shiftKey: true }), ...linux)
    ).toBe(false);

    // keyup should NOT trigger
    expect(
      shouldPasteToTerminal(
        makeEvent({ type: 'keyup', key: 'v', ctrlKey: true, shiftKey: true }),
        ...linux
      )
    ).toBe(false);
    expect(
      shouldPasteToTerminal(makeEvent({ type: 'keyup', key: 'v', ctrlKey: true }), ...win)
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

  it('detects plain Escape as interrupt intent', () => {
    expect(shouldHandleInterruptFromTerminal(makeEvent({ key: 'Escape' }))).toBe(true);
    expect(shouldHandleInterruptFromTerminal(makeEvent({ key: 'Escape', ctrlKey: true }))).toBe(
      false
    );
    expect(shouldHandleInterruptFromTerminal(makeEvent({ key: 'Escape', metaKey: true }))).toBe(
      false
    );
    expect(shouldHandleInterruptFromTerminal(makeEvent({ key: 'Escape', altKey: true }))).toBe(
      false
    );
    expect(shouldHandleInterruptFromTerminal(makeEvent({ type: 'keyup', key: 'Escape' }))).toBe(
      false
    );
  });
});
