import { updateService } from '@main/host/updates/update-service';
import { log } from '@main/lib/logger';
import type { Phase } from '../../core/phase';
import type { BootContext } from '../types';

export const updaterPhase: Phase<BootContext> = {
  name: 'updater',
  async run() {
    try {
      await updateService.initialize();
    } catch (error) {
      log.warn('Failed to initialize auto-update service', { error });
    }
  },
};
