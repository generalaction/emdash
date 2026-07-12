import { describe, expect, it } from 'vitest';
import {
  getDomTabNavigationDirection,
  getElectronTabNavigationDirection,
  getNumberHotkeys,
  resolveNumberFamilyBase,
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

describe('getNumberHotkeys', () => {
  it('expands a base hotkey into digits 1-9 with the same modifiers', () => {
    expect(getNumberHotkeys('Control+1')).toEqual([
      'Control+1',
      'Control+2',
      'Control+3',
      'Control+4',
      'Control+5',
      'Control+6',
      'Control+7',
      'Control+8',
      'Control+9',
    ]);
  });

  it('keeps multiple modifiers and ignores which digit was recorded', () => {
    expect(getNumberHotkeys('Mod+Shift+5')?.[0]).toBe('Mod+Shift+1');
    expect(getNumberHotkeys('Mod+Shift+5')?.[8]).toBe('Mod+Shift+9');
  });

  it('expands a bare digit without modifiers', () => {
    expect(getNumberHotkeys('3')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('returns null when the base does not end in a digit 1-9', () => {
    expect(getNumberHotkeys('Mod+K')).toBeNull();
    expect(getNumberHotkeys('Control+0')).toBeNull();
    expect(getNumberHotkeys('')).toBeNull();
  });
});

describe('resolveNumberFamilyBase', () => {
  it('returns the configured base when it expands to a digit family', () => {
    expect(resolveNumberFamilyBase('tabByNumber', 'Alt+1')).toBe('Alt+1');
  });

  it('returns null when the family is disabled', () => {
    expect(resolveNumberFamilyBase('tabByNumber', null)).toBeNull();
  });

  it('falls back to the default when the configured base has no trailing digit', () => {
    const fallback = resolveNumberFamilyBase('taskByNumber', 'Mod+K');
    expect(fallback).toBe('Mod+1');
  });

  it('resolves the default when nothing is configured', () => {
    expect(resolveNumberFamilyBase('taskByNumber', undefined)).toBe('Mod+1');
  });
});
