import { describe, expect, it } from 'vitest';
import { getDomTabNavigationDirection, getElectronTabNavigationDirection } from './shortcuts';

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
