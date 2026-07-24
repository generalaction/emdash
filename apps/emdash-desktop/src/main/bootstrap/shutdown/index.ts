import { app, type BrowserWindow } from 'electron';
import { desktopHostEvents } from '@core/features/workbench/node';
import type { DesktopRuntimeClients } from '@main/gateway/desktop-workers';
import { getActiveSessionSummary } from '@main/host/sessions/active-session-summary';
import { updateService } from '@main/host/updates/update-service';
import { createShutdownCoordinator } from './coordinator';
import { runQuitCleanup } from './phases';

let sessionClients: Pick<DesktopRuntimeClients, 'acp' | 'terminals' | 'tuiAgents'> | undefined;

const shutdownCoordinator = createShutdownCoordinator({
  emit: (event) => desktopHostEvents.emit(undefined, event),
  getActiveSessionSummary: () => {
    if (!sessionClients) throw new Error('Shutdown runtime clients have not been configured');
    return getActiveSessionSummary(sessionClients);
  },
  isInstallRequested: () => updateService.isInstallRequested,
  runCleanup: runQuitCleanup,
  exit: (code) => app.exit(code),
});

let registered = false;

export function configureShutdownRuntimeClients(
  clients: Pick<DesktopRuntimeClients, 'acp' | 'terminals' | 'tuiAgents'>
): void {
  sessionClients = clients;
}

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

export { createShutdownCoordinator, runQuitCleanup };
export type {
  QuitState,
  ShutdownCoordinator,
  ShutdownCoordinatorDependencies,
} from './coordinator';
