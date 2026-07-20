import { config as dotenvConfig } from 'dotenv';
import { runBootPreflight } from './boot/preflight';
import { isBootAborted, type BootContext } from './boot/types';
import { loadAppConfig, setAppConfig } from './core/config';

const CRASH_LOOP_THRESHOLD = 2;

export async function main(): Promise<void> {
  if (import.meta.env.DEV) {
    dotenvConfig({ path: '.env.local', override: false });
  }

  const config = loadAppConfig();
  setAppConfig(config);
  const context: BootContext = {
    config,
    accountService: undefined,
    appSettingsService: undefined,
    db: undefined,
    editorBufferService: undefined,
    notificationService: undefined,
    promptLibraryService: undefined,
    providerOverrideSettings: undefined,
    searchService: undefined,
    sqlite: undefined,
    ssh: undefined,
    windowPhaseReady: false,
    workspaceIdentity: undefined,
  };

  try {
    const previousFailures = await runBootPreflight(context);
    if (previousFailures >= CRASH_LOOP_THRESHOLD) {
      const { enterSafeMode } = await import('./core/recovery');
      await enterSafeMode(
        new Error(
          `Emdash entered recovery mode after ${previousFailures} consecutive failed launches`
        )
      );
      return;
    }

    const { finishBoot } = await import('./boot');
    await finishBoot(context);
  } catch (error) {
    if (isBootAborted(error)) return;
    throw error;
  }
}
