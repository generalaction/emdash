import { app, Menu, nativeImage, Tray } from 'electron';
import canaryIcon from '@/assets/images/emdash/emdash-canary.png?asset';
import devIcon from '@/assets/images/emdash/emdash-dev.png?asset';
import stableIcon from '@/assets/images/emdash/emdash.png?asset';
import { IS_CANARY, PRODUCT_NAME } from '@core/primitives/app-identity/api/app-identity';
import { showMainWindow } from './window';

let tray: Tray | null = null;

export function initializeTray(): Tray {
  if (tray && !tray.isDestroyed()) return tray;

  const iconPath = import.meta.env.DEV ? devIcon : IS_CANARY ? canaryIcon : stableIcon;
  const icon = nativeImage.createFromPath(iconPath).resize({
    width: process.platform === 'darwin' ? 18 : 20,
    height: process.platform === 'darwin' ? 18 : 20,
  });
  tray = new Tray(icon);
  tray.setToolTip(PRODUCT_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `Open ${PRODUCT_NAME}`,
        click: () => showMainWindow(),
      },
      { type: 'separator' },
      {
        label: `Quit ${PRODUCT_NAME}`,
        click: () => app.quit(),
      },
    ])
  );

  if (process.platform !== 'darwin') {
    tray.on('click', () => showMainWindow());
  }

  return tray;
}
