import { systemPreferences } from 'electron';
import { githubEvents } from '@core/features/github/node';
import { localDependencyManager } from '@main/core/dependencies/dependency-managers';
import { githubAccountReconciliationService } from '@main/core/github/accounts/github-account-reconciliation-instance';
import { log } from '@main/lib/logger';
import { runInBackground } from '../../core/background';
import type { Phase } from '../../core/phase';
import type { BootContext } from '../types';

export const backgroundPhase: Phase<BootContext> = {
  name: 'background-tasks',
  critical: false,
  run() {
    runInBackground('dependency-probe', async () => {
      await localDependencyManager.snapshot.mutate('refresh', { key: undefined, input: {} });
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
      await githubAccountReconciliationService.reconcileAtStartup();
      githubEvents.emit(undefined, {
        type: 'accounts-changed',
        reason: 'startup-reconciliation',
      });
    });
  },
};
