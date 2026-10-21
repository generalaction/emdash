import { systemPreferences } from 'electron';
import { integrationsEvents } from '@core/features/integrations/node/event-host';
import type { DesktopRuntimes } from '@main/gateway/desktop-runtimes';
import { log } from '@main/lib/logger';
import { runInBackground } from '../../core/background';
import { startMainDevPerfInstruments } from './dev-perf';
import { startPerfVitalsTelemetry } from './perf-vitals';
import type { ServicesBundle } from './services';
import { initializeUpdater } from './updater';

export function bootBackground(services: ServicesBundle, runtimes: DesktopRuntimes): void {
  startMainDevPerfInstruments();
  startPerfVitalsTelemetry(runtimes);

  // Updater init hits the network and must never block the boot chain; it
  // moved out of preflight under the window-first boot (spec build issue 2).
  runInBackground('updater-initialize', initializeUpdater);

  runInBackground('dependency-probe', async () => {
    await runtimes.clients.hostDependencies.snapshot.mutate('refresh', {
      key: undefined,
      input: {},
    });
  });

  if (
    process.platform === 'darwin' &&
    systemPreferences.getMediaAccessStatus('microphone') !== 'granted'
  ) {
    runInBackground('microphone-permission', async () => {
      const granted = await systemPreferences.askForMediaAccess('microphone');
      log.info('Microphone access request resolved:', { granted });
    });
  }

  runInBackground('github-account-reconciliation', async () => {
    // Run-once upgrade step (spec: github-git-settings §10): after the first
    // successful run this reads one flag row and performs no backfill work.
    try {
      if ((await services.github.legacyTokenImport.run()) === 'retry') {
        log.warn('Legacy GitHub account migration is incomplete; retrying next launch');
      }
    } catch (error) {
      log.warn('Legacy GitHub token import failed; retrying next launch', { error });
    }

    try {
      await services.github.cliImport.importAccounts();
    } catch (error) {
      log.warn('Failed to import GitHub CLI accounts during startup', { error });
    }

    integrationsEvents.emit(undefined, {
      type: 'accounts-changed',
      providerId: 'github',
    });
  });
}
