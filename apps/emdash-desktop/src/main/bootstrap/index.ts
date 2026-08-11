import { config as dotenvConfig } from 'dotenv';
import { log } from '@main/lib/logger';
import { runBootPreflight } from './boot/preflight';
import { isBootAborted, type BootSignals } from './boot/types';
import {
  markBootSuccessful,
  observePreviousBoot,
  recordBootFailure,
  writeBootingMarker,
} from './core/boot-guard';
import { onBootSettled, reportBootSuccessSignal, bootSuccessSignalsSeen } from './core/boot-status';
import { startBootWatchdog, type BootWatchdogTrigger } from './core/boot-watchdog';
import { loadAppConfig, setAppConfig, type AppConfig } from './core/config';
import { step } from './core/phase';

const CRASH_LOOP_THRESHOLD = 2;

export async function main(): Promise<void> {
  log.info('boot-timeline', {
    mark: 'main-entered',
    sinceProcessStartMs: Date.now() - (process.getCreationTime() ?? Date.now()),
  });
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
      // A crash-looping install gets the recovery window INSTEAD of the main
      // window — it must never flash the main window first.
      const { enterSafeMode } = await import('./core/recovery');
      await enterSafeMode(
        new Error(
          `Emdash entered recovery mode after ${previousFailures} consecutive failed launches`
        )
      );
      return;
    }

    // Boot is now in progress: the marker is written before the window exists
    // so a failure anywhere in the window-first chain is counted, and boot only
    // counts as successful when BOTH the backend chain and the window's
    // did-finish-load have fired (see boot-status).
    writeBootingMarker(config);
    onBootSettled(markBootSuccessful);
    const watchdog = startBootWatchdog({
      onTrigger: (trigger) => void handleBootWatchdogTrigger(trigger),
    });
    onBootSettled(watchdog.disarm);

    try {
      // Window-first: the window phase loads in its own (much smaller) chunk
      // and runs before the full backend module graph (`./boot`) is even
      // imported, so the ~0.5 s import cost is hidden behind the visible
      // window rather than delaying it.
      const { bootWindow } = await import('./boot/phases/window');
      await step('window', () => bootWindow(signals));
      const { finishBoot } = await import('./boot');
      await finishBoot(config);
    } catch (error) {
      watchdog.disarm();
      if (!isBootAborted(error)) await observeBackendBootFailure(config, error);
      throw error;
    }
    reportBootSuccessSignal('backend');
  } catch (error) {
    if (isBootAborted(error)) return;
    throw error;
  }
}

/**
 * Backend failure under window-first boot: count the failure immediately (a
 * clean recovery-window quit must not erase it) and destroy the visible main
 * window so safe mode opens the standalone recovery window exactly as before.
 * The recovery module itself stays independent of the boot graph — window
 * teardown happens here, on the boot side.
 */
async function observeBackendBootFailure(config: AppConfig, error: unknown): Promise<void> {
  recordBootFailure(config);
  try {
    const { getMainWindow } = await import('@main/host/window');
    const window = getMainWindow();
    if (window && !window.isDestroyed()) window.destroy();
  } catch (teardownError) {
    log.warn('Failed to destroy the main window after a boot failure', {
      error: teardownError,
      bootError: error,
    });
  }
  try {
    // Idempotent: finishBoot's own failure path already disposed the scope; a
    // window-phase failure (before finishBoot ran) is cleaned up here.
    const { appScope } = await import('./core/app-scope');
    await appScope.dispose(error);
  } catch (disposeError) {
    log.warn('Failed to dispose the app scope after a boot failure', { error: disposeError });
  }
}

async function handleBootWatchdogTrigger(trigger: BootWatchdogTrigger): Promise<void> {
  const signals = bootSuccessSignalsSeen();
  log.error('boot watchdog: boot has not settled', {
    stuckPhase: trigger.stuckPhase,
    backendCompleted: signals.backend,
    windowLoaded: signals.windowLoaded,
  });
  try {
    const { telemetryService } = await import('@main/lib/telemetry');
    telemetryService.capture('boot_watchdog_triggered', {
      stuck_phase: trigger.stuckPhase,
      backend_completed: signals.backend,
      window_loaded: signals.windowLoaded,
    });
  } catch (telemetryError) {
    log.warn('boot watchdog: failed to report telemetry', { error: telemetryError });
  }
  try {
    // Direct webContents channel: a hung backend means the wire gateway may
    // never register controllers, so the escape hatch cannot ride the wire.
    const { getMainWindow } = await import('@main/host/window');
    const contents = getMainWindow()?.webContents;
    if (contents && !contents.isDestroyed()) {
      contents.send('emdash:boot-stuck', { stuckPhase: trigger.stuckPhase });
    }
  } catch (sendError) {
    log.warn('boot watchdog: failed to signal the renderer escape hatch', { error: sendError });
  }
}
