import { log } from '@main/lib/logger';
import { runPhase } from '../core/phase';
import { backgroundPhase } from './phases/background';
import { databasePhase } from './phases/database';
import { gatewayPhase } from './phases/gateway';
import { configureServicesPhase, servicesPhase } from './phases/services';
import { windowPhase } from './phases/window';
import type { BootContext } from './types';

const bootPhases = [
  configureServicesPhase,
  databasePhase,
  servicesPhase,
  gatewayPhase,
  windowPhase,
  backgroundPhase,
];

export async function finishBoot(context: BootContext): Promise<void> {
  for (const phase of bootPhases) {
    try {
      await runPhase(phase, context);
    } catch (error) {
      if (phase.critical !== false) throw error;
      log.warn('Non-critical boot phase failed; continuing', {
        phase: phase.name,
        error,
      });
    }
  }
}
