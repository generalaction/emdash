import { join } from 'node:path';
import { app } from 'electron';
import { APP_NAME_LOWER, PRODUCT_NAME, USER_DATA_DIR_NAME } from '@shared/app-identity';

app.setName(PRODUCT_NAME);
app.setPath('userData', join(app.getPath('appData'), USER_DATA_DIR_NAME));

// Associate the running window with the installed .desktop file so GNOME Wayland
// can display the correct dock icon and group windows with the launcher entry.
if (process.platform === 'linux') {
  app.desktopFileName = `${APP_NAME_LOWER}.desktop`;
}
