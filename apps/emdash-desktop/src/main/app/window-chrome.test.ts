import { describe, expect, it } from 'vitest';
import { COMPACT_TITLEBAR_HEIGHT } from '@shared/app-menu';
import { getWindowChromeOptions } from './window-chrome';

describe('getWindowChromeOptions', () => {
  it('keeps the existing inset traffic light titlebar on macOS', () => {
    expect(getWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 10, y: 10 },
      acceptFirstMouse: true,
    });
  });

  it('uses compact titlebar overlay controls on Windows', () => {
    expect(getWindowChromeOptions('win32')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#f5f5f5',
        height: COMPACT_TITLEBAR_HEIGHT,
      },
      autoHideMenuBar: true,
    });
  });

  it('leaves Linux window chrome unchanged', () => {
    expect(getWindowChromeOptions('linux')).toEqual({});
  });
});
