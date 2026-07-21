import { systemPreferences } from 'electron';
import { githubEvents } from '@core/features/github/node';
import type { DesktopRuntimes } from '@main/gateway/desktop-runtimes';
import { log } from '@main/lib/logger';
import { runInBackground } from '../../core/background';
import type { ServicesBundle } from './services';

export function bootBackground(services: ServicesBundle, runtimes: DesktopRuntimes): void {
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
    await services.github.reconciliation.reconcileAtStartup();
    githubEvents.emit(undefined, {
      type: 'accounts-changed',
      reason: 'startup-reconciliation',
    });
  });
}
