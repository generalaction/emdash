import { join } from 'node:path';
import { app } from 'electron';
import type { AppConfig } from '../../core/config';
import { markUserDataConfigured } from '../../core/config';

export function applyIdentity(config: AppConfig): void {
  app.setName(config.identity.productName);
  app.setPath('userData', join(app.getPath('appData'), config.identity.userDataDirName));
  markUserDataConfigured();
}
