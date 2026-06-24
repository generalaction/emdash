import { app } from 'electron';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { automationsService } from '@main/core/automations/automations-service';
import { prSyncScheduler } from '@main/core/pull-requests/pr-sync-scheduler';
import { stopResourceSampler } from '@main/core/resource-monitor/resource-sampler';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import { updateService } from '@main/core/updates/update-service';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { projectManager } from '../core/projects/project-manager';

/* Maximum time (ms) to wait for the critical shutdown phase to complete. */
const CRITICAL_DEADLINE_MS = 5_000;
/* Grace window (ms) given to best-effort teardown before the force-exit fires. */
const GRACE_WINDOW_MS = 400;
/* Hard outer deadline (ms) for the entire quit sequence. */
const HARD_DEADLINE_MS = 8_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * two phase shutdown sequence:
 * - critical phase — awaited, bounded by CRITICAL_DEADLINE_MS
 * - best effort phase — voided, abandoned after GRACE_WINDOW_MS
 */
export async function runQuitCleanup(): Promise<void> {
  telemetryService.capture('app_closed');

  // synchronous stops
  automationsService.stop();
  agentHookService.dispose();
  stopResourceSampler();
  updateService.dispose();
  prSyncScheduler.dispose();

  // critical phase
  const criticalSteps: Array<() => Promise<void>> = [
    () => projectManager.release(),
    () => runtimeManager.dispose(),
    () => telemetryService.dispose(),
  ];
  await withDeadline(
    (async () => {
      for (const step of criticalSteps) await step();
    })(),
    CRITICAL_DEADLINE_MS
  ).catch((e: unknown) => {
    log.error('quit: critical cleanup failed or timed out', e);
  });

  // best effort phase
  const bestEffortSteps: Array<() => void | Promise<void>> = [() => projectManager.dispose()];
  const graceful = Promise.allSettled(bestEffortSteps.map((fn) => Promise.resolve().then(fn)));
  await Promise.race([graceful, delay(GRACE_WINDOW_MS)]);
}

export function registerQuitHandler(): void {
  let started = false;
  app.on('before-quit', (event) => {
    event.preventDefault();
    if (started) return;
    started = true;

    const forceExit = setTimeout(() => {
      log.warn('quit: hard deadline reached, forcing exit');
      app.exit(0);
    }, HARD_DEADLINE_MS);

    void runQuitCleanup().finally(() => {
      clearTimeout(forceExit);
      app.exit(0);
    });
  });
}
