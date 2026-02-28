import { describe, expect, it } from 'vitest';
import {
  CTRL_J_ASCII,
  getMacKeybindingSequence,
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

describe('getMacKeybindingSequence', () => {
  const makeEvent = (overrides: Partial<KeyEventLike> = {}): KeyEventLike => ({
    type: 'keydown',
    key: '',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  });

  describe('Cmd keybindings', () => {
    it('Cmd+Left -> Ctrl+A (beginning-of-line)', () => {
      expect(getMacKeybindingSequence(makeEvent({ key: 'ArrowLeft', metaKey: true }))).toBe('\x01');
    });

    it('Cmd+Right -> Ctrl+E (end-of-line)', () => {
      expect(getMacKeybindingSequence(makeEvent({ key: 'ArrowRight', metaKey: true }))).toBe(
        '\x05'
      );
    });

    it('Cmd+Backspace -> Ctrl+U (unix-line-discard)', () => {
      expect(getMacKeybindingSequence(makeEvent({ key: 'Backspace', metaKey: true }))).toBe('\x15');
    });

    it('Cmd+Delete -> Ctrl+K (kill-line forward)', () => {
      expect(getMacKeybindingSequence(makeEvent({ key: 'Delete', metaKey: true }))).toBe('\x0b');
    });

    it('Shift+Cmd+Left -> Shift+Home (select to line start)', () => {
      expect(
        getMacKeybindingSequence(makeEvent({ key: 'ArrowLeft', metaKey: true, shiftKey: true }))
      ).toBe('\x1b[1;2H');
    });

    it('Shift+Cmd+Right -> Shift+End (select to line end)', () => {
      expect(
        getMacKeybindingSequence(makeEvent({ key: 'ArrowRight', metaKey: true, shiftKey: true }))
      ).toBe('\x1b[1;2F');
    });
  });

  describe('Opt keybindings', () => {
    it('Opt+Left -> ESC b (backward-word)', () => {
      expect(getMacKeybindingSequence(makeEvent({ key: 'ArrowLeft', altKey: true }))).toBe('\x1bb');
    });

    it('Opt+Right -> ESC f (forward-word)', () => {
      expect(getMacKeybindingSequence(makeEvent({ key: 'ArrowRight', altKey: true }))).toBe(
        '\x1bf'
      );
    });

    it('Opt+Backspace -> ESC DEL (backward-kill-word)', () => {
      expect(getMacKeybindingSequence(makeEvent({ key: 'Backspace', altKey: true }))).toBe(
        '\x1b\x7f'
      );
    });

    it('Opt+Delete -> ESC d (kill-word forward)', () => {
      expect(getMacKeybindingSequence(makeEvent({ key: 'Delete', altKey: true }))).toBe('\x1bd');
    });

    it('Shift+Opt+Left -> Shift+Alt+Left (select word backward)', () => {
      expect(
        getMacKeybindingSequence(makeEvent({ key: 'ArrowLeft', altKey: true, shiftKey: true }))
      ).toBe('\x1b[1;4D');
    });

    it('Shift+Opt+Right -> Shift+Alt+Right (select word forward)', () => {
      expect(
        getMacKeybindingSequence(makeEvent({ key: 'ArrowRight', altKey: true, shiftKey: true }))
      ).toBe('\x1b[1;4C');
    });
  });

  describe('returns null for non-macOS combos', () => {
    it('plain keys without modifiers', () => {
      expect(getMacKeybindingSequence(makeEvent({ key: 'ArrowLeft' }))).toBeNull();
      expect(getMacKeybindingSequence(makeEvent({ key: 'Backspace' }))).toBeNull();
    });

    it('Ctrl combos (not macOS-specific)', () => {
      expect(getMacKeybindingSequence(makeEvent({ key: 'ArrowLeft', ctrlKey: true }))).toBeNull();
    });

    it('Cmd+Ctrl combos (mixed modifiers)', () => {
      expect(
        getMacKeybindingSequence(makeEvent({ key: 'ArrowLeft', metaKey: true, ctrlKey: true }))
      ).toBeNull();
    });

    it('Cmd+Alt combos (mixed modifiers)', () => {
      expect(
        getMacKeybindingSequence(makeEvent({ key: 'ArrowLeft', metaKey: true, altKey: true }))
      ).toBeNull();
    });

    it('keyup events', () => {
      expect(
        getMacKeybindingSequence(makeEvent({ type: 'keyup', key: 'ArrowLeft', metaKey: true }))
      ).toBeNull();
    });

    it('unmapped keys with Cmd', () => {
      expect(getMacKeybindingSequence(makeEvent({ key: 'a', metaKey: true }))).toBeNull();
      expect(getMacKeybindingSequence(makeEvent({ key: 'ArrowUp', metaKey: true }))).toBeNull();
    });

    it('unmapped keys with Opt', () => {
      expect(getMacKeybindingSequence(makeEvent({ key: 'a', altKey: true }))).toBeNull();
      expect(getMacKeybindingSequence(makeEvent({ key: 'ArrowUp', altKey: true }))).toBeNull();
    });
  });
});
