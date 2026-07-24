import { config as dotenvConfig } from 'dotenv';
import { runBootPreflight } from './boot/preflight';
import { isBootAborted, type BootSignals } from './boot/types';
import { observePreviousBoot } from './core/boot-guard';
import { loadAppConfig, setAppConfig } from './core/config';

const CRASH_LOOP_THRESHOLD = 2;

export async function main(): Promise<void> {
  if (import.meta.env.DEV) {
    dotenvConfig({ path: '.env.local', override: false });
  }

  const config = loadAppConfig();
  setAppConfig(config);
  const signals: BootSignals = { windowPhaseReady: false };

  try {
    await runBootPreflight(config, signals);
    const { failures: previousFailures } = observePreviousBoot(config);
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
    await finishBoot(config, signals);
  } catch (error) {
    if (isBootAborted(error)) return;
    throw error;
  }
}
