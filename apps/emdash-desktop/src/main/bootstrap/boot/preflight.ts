import { runPhase } from '../core/phase';
import { applyIdentityPhase } from './phases/apply-identity';
import { prepareElectronPhase } from './phases/prepare-electron';
import { updaterPhase } from './phases/updater';
import type { BootContext } from './types';

export async function runBootPreflight(context: BootContext): Promise<void> {
  await runPhase(applyIdentityPhase, context);
  await runPhase(prepareElectronPhase, context);
  await runPhase(updaterPhase, context);
}
