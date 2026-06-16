import type { BrowserWindowConstructorOptions } from 'electron';
import { COMPACT_TITLEBAR_HEIGHT } from '@shared/app-menu';

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  | 'acceptFirstMouse'
  | 'autoHideMenuBar'
  | 'titleBarOverlay'
  | 'titleBarStyle'
  | 'trafficLightPosition'
>;

export function getWindowChromeOptions(platform: NodeJS.Platform): WindowChromeOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 10, y: 10 },
      acceptFirstMouse: true,
    };
  }

  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: '#f5f5f5',
        height: COMPACT_TITLEBAR_HEIGHT,
      },
      autoHideMenuBar: true,
    };
  }

  return {};
}
