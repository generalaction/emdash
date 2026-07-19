import { randomUUID } from 'node:crypto';
import { app, type BrowserWindow } from 'electron';
import type {
  ActiveSessionSummary,
  DesktopHostEvent,
} from '@core/features/workbench/api/host-contract';
import { desktopHostEvents } from '@core/features/workbench/node';
import { pullRequestsRegistration } from '@core/services/pull-requests/node/pull-requests-registration';
import { acpAgentStatusBridge } from '@main/core/acp/agent-status-bridge';
import { agentStatusService } from '@main/core/agent-status/agent-status-service';
import { tuiAgentStatusBridge } from '@main/core/agent-status/tui-agent-status-bridge';
import { automationsService } from '@main/core/automations/automations-service';
import { operationsService } from '@main/core/operations/operations-service';
import { disposeDesktopWireWorkers } from '@main/gateway/desktop-workers';
import { updateService } from '@main/host/updates/update-service';
import { getMainWindow } from '@main/host/window';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { disposeNotificationService } from '@root/src/core/services/notifications/node';
import { projectManager } from '../core/projects/project-manager';
import { getActiveSessionSummary } from './active-session-summary';
import { appScope } from './app-scope';

const CONFIRMATION_DEADLINE_MS = 60_000;
const FLUSH_DEADLINE_MS = 2_000;
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
  void promise.catch(() => undefined);
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export type QuitState = 'idle' | 'confirming' | 'shutting-down';
type ConfirmationSource = 'renderer' | 'timeout' | 'renderer-invalidated' | 'install';
interface ConfirmationResolution {
  confirmed: boolean;
  source: ConfirmationSource;
}

export interface ShutdownCoordinatorDependencies {
  emit(event: DesktopHostEvent): void;
  getActiveSessionSummary(): Promise<ActiveSessionSummary>;
  getWindow(): BrowserWindow | null;
  isInstallRequested(): boolean;
  runCleanup(): Promise<void>;
  exit(code: number): void;
}

export interface ShutdownCoordinator {
  readonly state: QuitState;
  handleQuitRequested(): Promise<void>;
  resolveQuitConfirmation(requestId: string, confirmed: boolean): void;
  ackShutdownFlush(): void;
  markShutdownReady(): void;
  watchWindow(window: BrowserWindow): void;
  isShutdownInProgress(): boolean;
}

export function createShutdownCoordinator(
  dependencies: ShutdownCoordinatorDependencies
): ShutdownCoordinator {
  let state: QuitState = 'idle';
  let capableWebContentsId: number | null = null;
  let pendingConfirmation:
    | {
        requestId: string;
        resolve(resolution: ConfirmationResolution): void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;
  let pendingFlush:
    | {
        resolve(): void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;

  const isRendererShutdownCapable = (): boolean => {
    const window = dependencies.getWindow();
    return (
      window !== null &&
      !window.isDestroyed() &&
      window.webContents.id === capableWebContentsId &&
      !window.webContents.isDestroyed()
    );
  };

  const settleConfirmation = (confirmed: boolean, source: ConfirmationSource): void => {
    const pending = pendingConfirmation;
    if (!pending) return;
    pendingConfirmation = undefined;
    clearTimeout(pending.timer);
    pending.resolve({ confirmed, source });
  };

  const settleFlush = (): void => {
    const pending = pendingFlush;
    if (!pending) return;
    pendingFlush = undefined;
    clearTimeout(pending.timer);
    pending.resolve();
  };

  const invalidateRenderer = (webContentsId: number): void => {
    if (capableWebContentsId !== webContentsId) return;
    capableWebContentsId = null;
    settleConfirmation(false, 'renderer-invalidated');
    settleFlush();
  };

  const requestConfirmation = async (): Promise<boolean> => {
    const window = dependencies.getWindow();
    if (!window || window.isDestroyed()) return false;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();

    const summary = await dependencies.getActiveSessionSummary();
    if (dependencies.isInstallRequested()) return true;
    if (!isRendererShutdownCapable()) return false;

    const requestId = randomUUID();
    const confirmed = new Promise<ConfirmationResolution>((resolve) => {
      const timer = setTimeout(() => {
        if (pendingConfirmation?.requestId !== requestId) return;
        log.warn('quit: renderer confirmation timed out, proceeding with shutdown');
        settleConfirmation(true, 'timeout');
      }, CONFIRMATION_DEADLINE_MS);
      pendingConfirmation = { requestId, resolve, timer };
    });

    dependencies.emit({ type: 'quit-confirmation-requested', requestId, summary });
    const result = await confirmed;
    if (!result.confirmed || result.source !== 'renderer') {
      dependencies.emit({ type: 'quit-confirmation-cancelled', requestId });
    }
    return result.confirmed;
  };

  const flushRenderer = async (): Promise<void> => {
    if (!isRendererShutdownCapable()) return;
    const flushed = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (pendingFlush?.resolve !== resolve) return;
        pendingFlush = undefined;
        resolve();
      }, FLUSH_DEADLINE_MS);
      pendingFlush = { resolve, timer };
    });
    dependencies.emit({ type: 'shutdown-started' });
    await flushed;
  };

  const runShutdown = async (): Promise<void> => {
    let exited = false;
    const exit = (): void => {
      if (exited) return;
      exited = true;
      dependencies.exit(0);
    };
    const forceExit = setTimeout(() => {
      log.warn('quit: hard deadline reached, forcing exit');
      exit();
    }, HARD_DEADLINE_MS);

    try {
      await flushRenderer();
      await dependencies.runCleanup();
    } catch (error) {
      log.error('quit: shutdown sequence failed', error);
    } finally {
      clearTimeout(forceExit);
      exit();
    }
  };

  return {
    get state() {
      return state;
    },
    async handleQuitRequested() {
      if (state === 'confirming' && dependencies.isInstallRequested()) {
        settleConfirmation(true, 'install');
        return;
      }
      if (state !== 'idle') return;

      if (!dependencies.isInstallRequested() && isRendererShutdownCapable()) {
        state = 'confirming';
        let confirmed = false;
        try {
          confirmed = await requestConfirmation();
        } catch (error) {
          log.error('quit: confirmation failed', error);
        }
        confirmed ||= dependencies.isInstallRequested();
        if (!confirmed) {
          state = 'idle';
          return;
        }
      }

      state = 'shutting-down';
      await runShutdown();
    },
    resolveQuitConfirmation(requestId, confirmed) {
      if (pendingConfirmation?.requestId !== requestId) return;
      settleConfirmation(confirmed, 'renderer');
    },
    ackShutdownFlush() {
      settleFlush();
    },
    markShutdownReady() {
      const window = dependencies.getWindow();
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
      capableWebContentsId = window.webContents.id;
    },
    watchWindow(window) {
      const webContentsId = window.webContents.id;
      window.webContents.on('did-start-loading', () => invalidateRenderer(webContentsId));
      window.webContents.on('render-process-gone', () => invalidateRenderer(webContentsId));
      window.on('closed', () => invalidateRenderer(webContentsId));
    },
    isShutdownInProgress() {
      return state !== 'idle';
    },
  };
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
  updateService.dispose();
  disposeNotificationService();
  pullRequestsRegistration.dispose();

  // critical phase
  const criticalSteps: Array<[string, () => Promise<void>]> = [
    ['acpAgentStatusBridge.dispose', async () => acpAgentStatusBridge.dispose()],
    ['tuiAgentStatusBridge.dispose', async () => tuiAgentStatusBridge.dispose()],
    ['agentStatusService.dispose', async () => agentStatusService.dispose()],
    ['operationsService.dispose', () => operationsService.dispose()],
    ['projectManager.release', () => projectManager.release()],
    ['disposeDesktopWireWorkers', () => disposeDesktopWireWorkers()],
    ['appScope.dispose', () => appScope.dispose()],
    ['telemetryService.dispose', () => telemetryService.dispose()],
  ];
  await withDeadline(
    (async () => {
      for (const [name, step] of criticalSteps) {
        try {
          await step();
        } catch (e) {
          log.error(`quit: critical step ${name} failed`, e);
        }
      }
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

const shutdownCoordinator = createShutdownCoordinator({
  emit: (event) => desktopHostEvents.emit(undefined, event),
  getActiveSessionSummary,
  getWindow: () => getMainWindow(),
  isInstallRequested: () => updateService.isInstallRequested,
  runCleanup: runQuitCleanup,
  exit: (code) => app.exit(code),
});

let registered = false;

export function registerQuitHandler(): void {
  if (registered) return;
  registered = true;
  app.on('before-quit', (event) => {
    event.preventDefault();
    void shutdownCoordinator.handleQuitRequested();
  });
}

export function resolveQuitConfirmation(requestId: string, confirmed: boolean): void {
  shutdownCoordinator.resolveQuitConfirmation(requestId, confirmed);
}

export function ackShutdownFlush(): void {
  shutdownCoordinator.ackShutdownFlush();
}

export function markShutdownReady(): void {
  shutdownCoordinator.markShutdownReady();
}

export function watchWindow(window: BrowserWindow): void {
  shutdownCoordinator.watchWindow(window);
}

export function isShutdownInProgress(): boolean {
  return shutdownCoordinator.isShutdownInProgress();
}

export function shouldAllowWindowClose(): boolean {
  return shutdownCoordinator.state === 'shutting-down' || updateService.isInstallRequested;
}
