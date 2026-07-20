import { observePreviousBoot } from '../core/boot-guard';
import { runPhase } from '../core/phase';
import { applyIdentityPhase } from './phases/apply-identity';
import { prepareElectronPhase } from './phases/prepare-electron';
import { updaterPhase } from './phases/updater';
import type { BootContext } from './types';

export async function runBootPreflight(context: BootContext): Promise<number> {
  await runPhase(applyIdentityPhase, context);
  await runPhase(prepareElectronPhase, context);
  const { failures } = observePreviousBoot(context.config);
  await runPhase(updaterPhase, context);
  return failures;
}
