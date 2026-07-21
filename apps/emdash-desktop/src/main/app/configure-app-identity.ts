import { join } from 'node:path';
import { app } from 'electron';
import {
  APP_NAME_LOWER,
  IS_CANARY,
  PRODUCT_NAME,
  USER_DATA_DIR_NAME,
} from '@shared/app-identity';

app.setName(PRODUCT_NAME);
app.setPath('userData', join(app.getPath('appData'), USER_DATA_DIR_NAME));

// Must match the .desktop filename produced by electron-builder: stable uses
// PRODUCT_NAME (executableName defaults to productName), canary overrides
// linux.executableName to APP_NAME_LOWER.
if (process.platform === 'linux') {
  const desktopName = IS_CANARY ? APP_NAME_LOWER : PRODUCT_NAME;
  app.desktopFileName = `${desktopName}.desktop`;
}
