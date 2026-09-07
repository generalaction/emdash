import { join } from 'node:path';
import { app } from 'electron';
import type { AppConfig } from '../../core/config';
import { markUserDataConfigured } from '../../core/config';

export function applyIdentity(config: AppConfig): void {
  app.setName(config.identity.productName);
  // EMDASH_USER_DATA_DIR redirects the whole profile (DB, logs, mementos) to an
  // isolated directory — used by the boot-measurement harness and scratch profiles.
  const userDataPath =
    config.userDataDir ?? join(app.getPath('appData'), config.identity.userDataDirName);
  app.setPath('userData', userDataPath);
  markUserDataConfigured();
}
