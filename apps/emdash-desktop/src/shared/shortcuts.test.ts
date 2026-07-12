import { describe, expect, it } from 'vitest';
import {
  APP_SHORTCUTS,
  getDomTabNavigationDirection,
  getElectronTabNavigationDirection,
  resolveDefaultHotkey,
  TAB_BY_NUMBER_KEYS,
  TASK_BY_NUMBER_KEYS,
} from './shortcuts';

describe('tab navigation shortcuts', () => {
  it('recognizes DOM Control+Tab navigation', () => {
    expect(
      getDomTabNavigationDirection({
        type: 'keydown',
        key: 'Tab',
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      })
    ).toBe('next');

    expect(
      getDomTabNavigationDirection({
        type: 'keydown',
        key: 'Tab',
        ctrlKey: true,
        shiftKey: true,
        altKey: false,
        metaKey: false,
      })
    ).toBe('previous');
  });

  it('recognizes Electron Control+Tab navigation', () => {
    expect(
      getElectronTabNavigationDirection({
        type: 'keyDown',
        key: 'Tab',
        control: true,
        shift: false,
        alt: false,
        meta: false,
      })
    ).toBe('next');

    expect(
      getElectronTabNavigationDirection({
        type: 'keyDown',
        key: 'Tab',
        control: true,
        shift: true,
        alt: false,
        meta: false,
      })
    ).toBe('previous');
  });

  it('ignores modified or non-keydown tab inputs', () => {
    expect(
      getDomTabNavigationDirection({
        type: 'keyup',
        key: 'Tab',
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      })
    ).toBeNull();

    expect(
      getElectronTabNavigationDirection({
        type: 'keyDown',
        key: 'Tab',
        control: true,
        shift: false,
        alt: true,
        meta: false,
      })
    ).toBeNull();
  });
});

describe('number shortcut defaults', () => {
  it('binds each task digit to Mod+digit', () => {
    TASK_BY_NUMBER_KEYS.forEach((key, i) => {
      expect(resolveDefaultHotkey(APP_SHORTCUTS[key])).toBe(`Mod+${i + 1}`);
    });
  });

  it('binds each tab digit to a per-platform default ending in the digit', () => {
    TAB_BY_NUMBER_KEYS.forEach((key, i) => {
      const hotkey = resolveDefaultHotkey(APP_SHORTCUTS[key]);
      expect(hotkey).toMatch(new RegExp(`\\+${i + 1}$`));
    });
  });
});
