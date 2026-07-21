import { config as dotenvConfig } from 'dotenv';
import { runBootPreflight } from './boot/preflight';
import { isBootAborted, type BootContext } from './boot/types';
import { observePreviousBoot } from './core/boot-guard';
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
    automationsService: undefined,
    appSettingsService: undefined,
    db: undefined,
    editorBufferService: undefined,
    githubServices: undefined,
    notificationService: undefined,
    issueProviders: undefined,
    operations: undefined,
    promptLibraryService: undefined,
    pullRequestsRegistration: undefined,
    projectManager: undefined,
    projectSettingsService: undefined,
    providerOverrideSettings: undefined,
    searchService: undefined,
    taskService: undefined,
    taskSessionManager: undefined,
    sqlite: undefined,
    ssh: undefined,
    windowPhaseReady: false,
    workspaceIdentity: undefined,
    workspaceBootstrapService: undefined,
    workspacePlacement: undefined,
    workspaceServer: undefined,
  };

  try {
    await runBootPreflight(context);
    const { failures: previousFailures } = observePreviousBoot(context.config);
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
