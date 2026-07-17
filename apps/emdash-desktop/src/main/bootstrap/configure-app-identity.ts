import { join } from 'node:path';
import { app } from 'electron';
import { PRODUCT_NAME, USER_DATA_DIR_NAME } from '@core/primitives/app-identity/api/app-identity';

app.setName(PRODUCT_NAME);
app.setPath('userData', join(app.getPath('appData'), USER_DATA_DIR_NAME));
