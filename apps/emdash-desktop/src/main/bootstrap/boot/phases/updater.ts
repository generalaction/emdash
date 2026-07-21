import { updateService } from '@main/host/updates/update-service';
import { log } from '@main/lib/logger';
import type { Phase } from '../../core/phase';
import type { BootContext } from '../types';

export const updaterPhase: Phase<BootContext> = {
  name: 'updater',
  async run() {
    try {
      // initialize() is idempotent because recovery mode may also call it
      // after a failure in a later boot phase.
      await updateService.initialize();
    } catch (error) {
      log.warn('Failed to initialize auto-update service', { error });
    }
  },
};
