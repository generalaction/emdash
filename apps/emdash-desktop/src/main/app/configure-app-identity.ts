import { join } from 'node:path';
import { app } from 'electron';
import { PRODUCT_NAME, USER_DATA_DIR_NAME } from '@shared/app-identity';

app.setName(PRODUCT_NAME);
const loopsElectronUserData =
  import.meta.env.MODE === 'loops-electron' && process.env.EMDASH_LOOPS_ELECTRON_TEST === '1'
    ? process.env.EMDASH_LOOPS_ELECTRON_USER_DATA?.trim()
    : undefined;
app.setPath('userData', loopsElectronUserData || join(app.getPath('appData'), USER_DATA_DIR_NAME));
