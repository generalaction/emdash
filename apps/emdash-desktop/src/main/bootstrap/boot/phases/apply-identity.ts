import { join } from 'node:path';
import { app } from 'electron';
import { markUserDataConfigured } from '../../core/config';
import type { Phase } from '../../core/phase';
import type { BootContext } from '../types';

export const applyIdentityPhase: Phase<BootContext> = {
  name: 'apply-identity',
  run({ config }) {
    app.setName(config.identity.productName);
    app.setPath('userData', join(app.getPath('appData'), config.identity.userDataDirName));
    markUserDataConfigured();
  },
};
