import { describe, expect, it } from 'vitest';
import {
  CTRL_J_ASCII,
  shouldMapShiftEnterToCtrlJ,
  type KeyEventLike,
} from '../../renderer/terminal/terminalKeybindings';

/**
 * Tests for the Shift+Enter to Ctrl+J keyboard mapping in TerminalSessionManager
 *
 * These tests verify the shouldMapShiftEnterToCtrlJ method logic and ensure that
 * Shift+Enter is correctly mapped to Ctrl+J for CLI agents.
 */
describe('TerminalSessionManager - Shift+Enter to Ctrl+J mapping', () => {
  const makeEvent = (overrides: Partial<KeyEventLike>): KeyEventLike => ({
    type: 'keydown',
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
  });

  describe('shouldMapShiftEnterToCtrlJ logic', () => {
    it('should return true for Shift+Enter without other modifiers', () => {
      expect(shouldMapShiftEnterToCtrlJ(makeEvent({ shiftKey: true }))).toBe(true);
    });

    it('should return false for Enter without Shift', () => {
      expect(shouldMapShiftEnterToCtrlJ(makeEvent({ shiftKey: false }))).toBe(false);
    });

    it('should return false for Shift+Enter with Ctrl modifier', () => {
      expect(
        shouldMapShiftEnterToCtrlJ(
          makeEvent({
            shiftKey: true,
            ctrlKey: true,
          })
        )
      ).toBe(false);
    });

    it('should return false for Shift+Enter with Meta/Command modifier', () => {
      expect(
        shouldMapShiftEnterToCtrlJ(
          makeEvent({
            shiftKey: true,
            metaKey: true,
          })
        )
      ).toBe(false);
    });

    it('should return false for Shift+Enter with Alt modifier', () => {
      expect(
        shouldMapShiftEnterToCtrlJ(
          makeEvent({
            shiftKey: true,
            altKey: true,
          })
        )
      ).toBe(false);
    });

    it('should return false for other keys with Shift (e.g., Shift+A)', () => {
      expect(shouldMapShiftEnterToCtrlJ(makeEvent({ key: 'a', shiftKey: true }))).toBe(false);
    });

    it('should return false for keyup events', () => {
      expect(shouldMapShiftEnterToCtrlJ(makeEvent({ type: 'keyup', shiftKey: true }))).toBe(false);
    });

    it('should return false for Ctrl+J (original combination)', () => {
      expect(shouldMapShiftEnterToCtrlJ(makeEvent({ key: 'j', ctrlKey: true }))).toBe(false);
    });
  });

  describe('CTRL_J_ASCII constant', () => {
    it('should have the correct ASCII value for line feed', () => {
      expect(CTRL_J_ASCII.charCodeAt(0)).toBe(10); // ASCII code for LF
      expect(CTRL_J_ASCII).toBe('\n'); // LF is newline
    });
  });
});
