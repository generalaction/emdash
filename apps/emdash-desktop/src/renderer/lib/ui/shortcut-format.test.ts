import { parseHotkey } from '@tanstack/react-hotkeys';
import { describe, expect, it } from 'vitest';
import {
  describeShortcut,
  formatShortcutKey,
  getShortcutKeyOpticalAlignClass,
  getShortcutKeys,
} from './shortcut-format';

describe('shortcut formatting', () => {
  it('describes Mod as Command on macOS', () => {
    const parsed = parseHotkey('Mod+Shift+T', 'mac');

    expect(describeShortcut(parsed, 'mac')).toBe('Command Shift T');
  });

  it('describes Mod as Control on non-macOS platforms', () => {
    const parsed = parseHotkey('Mod+Shift+T', 'windows');

    expect(describeShortcut(parsed, 'windows')).toBe('Control Shift T');
  });

  it('uses spoken labels for symbolic navigation keys', () => {
    const parsed = parseHotkey('Alt+Mod+ArrowRight', 'mac');

    expect(describeShortcut(parsed, 'mac')).toBe('Option Command Right Arrow');
  });

  it('orders macOS modifiers as Control, Option, Command, Shift', () => {
    const parsed = parseHotkey('Meta+Shift+Alt+Control+K', 'mac');

    expect(getShortcutKeys(parsed, 'mac')).toEqual(['Control', 'Alt', 'Meta', 'Shift', 'K']);
    expect(describeShortcut(parsed, 'mac')).toBe('Control Option Command Shift K');
  });

  it('orders Windows modifiers as Control, Alt, Shift, Windows', () => {
    const parsed = parseHotkey('Meta+Shift+Alt+Control+K', 'windows');

    expect(getShortcutKeys(parsed, 'windows')).toEqual(['Control', 'Alt', 'Shift', 'Meta', 'K']);
    expect(describeShortcut(parsed, 'windows')).toBe('Control Alt Shift Windows K');
  });

  it('uses explicit visible labels for common navigation keys', () => {
    expect(formatShortcutKey('Enter', 'mac')).toBe('⏎');
    expect(formatShortcutKey('PageUp', 'mac')).toBe('PgUp');
    expect(formatShortcutKey('PageDown', 'mac')).toBe('PgDn');
    expect(formatShortcutKey('Home', 'mac')).toBe('Home');
    expect(formatShortcutKey('End', 'mac')).toBe('End');
  });

  it('optically raises punctuation and operators with low visual centers', () => {
    expect(getShortcutKeyOpticalAlignClass('(')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass(')')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass('+')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass(',')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass('-')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass('.')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass(':')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass(';')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass('=')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass('[')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass(']')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass('{')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass('}')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass('/')).toBe('-translate-y-px');
    expect(getShortcutKeyOpticalAlignClass('\\')).toBe('-translate-y-px');
  });
});
