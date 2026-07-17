import { join } from 'node:path';
import { initializeNotificationService } from '@core/services/notifications/node';
import { pullRequestsRegistration } from '@core/services/pull-requests/node/pull-requests-registration';
import { config as dotenvConfig } from 'dotenv';
import { sql } from 'drizzle-orm';
import { app, BrowserWindow, dialog, ipcMain, systemPreferences } from 'electron';
import devIcon from '@/assets/images/emdash/emdash-dev.png?asset';
import { emdashAccountService } from '@main/core/account/services/emdash-account-service';
import { acpAgentStatusBridge } from '@main/core/acp/agent-status-bridge';
import { tuiAgentStatusBridge } from '@main/core/agent-status/tui-agent-status-bridge';
import { appService } from '@main/core/app/service';
import { automationsService } from '@main/core/automations/automations-service';
import { resetStaleAcpAgentStatuses } from '@main/core/conversations/reset-stale-acp-agent-statuses';
import { resetStaleTuiAgentStatuses } from '@main/core/conversations/reset-stale-tui-agent-statuses';
import { localDependencyManager } from '@main/core/dependencies/dependency-managers';
import { editorBufferService } from '@main/core/editor/editor-buffer-service';
import { githubAccountReconciliationService } from '@main/core/github/accounts/github-account-reconciliation-instance';
import { startLifecycleReconciler } from '@main/core/operations/lifecycle-reconciler';
import { operationsService } from '@main/core/operations/operations-service';
import { projectSettingsService } from '@main/core/projects/settings/project-settings-service';
import { promptLibraryService } from '@main/core/prompt-library/service';
import { searchService } from '@main/core/search/search-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import { db } from '@main/db/client';
import { initializeDatabase } from '@main/db/initialize';
import { projects, tasks } from '@main/db/schema';
import { installDesktopWire } from '@main/gateway/desktop-wire';
import {
  acpWorker,
  agentConfigWorker,
  ensureFileSearchWorkerReady,
  ensureFilesWorkerReady,
  ensureGitWorkerReady,
  ensureMementosWorkerReady,
  ensureTuiAgentsWorkerReady,
  getMementosRuntimeClient,
} from '@main/gateway/desktop-workers';
import { cleanupLegacyBrowserPartitions } from '@main/host/browser/browser-partition-cleanup';
import { setBrowserCorsRelaxationSettings } from '@main/host/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import { events } from '@main/host/events';
import {
  initializeFileLogger,
  registerProcessErrorLogging,
  registerRendererLogHandler,
} from '@main/host/file-logger';
import {
  LIBSECRET_PASSWORD_STORE,
  shouldForceLibsecretBackend,
} from '@main/host/linux-secret-storage';
import { setupApplicationMenu } from '@main/host/menu';
import { registerAppScheme, setupAppProtocol } from '@main/host/protocol';
import { withRpcLogging } from '@main/host/rpc-logging';
import { updateService } from '@main/host/updates/update-service';
import { createMainWindow } from '@main/host/window';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { resolveUserEnv } from '@main/lib/userEnv';
import { rpcRouter } from '@main/rpc';
import { PRODUCT_NAME } from '@shared/app-identity';
import { githubAccountsChangedChannel } from '@shared/events/githubEvents';
import { registerRPCRouter } from '@shared/lib/ipc/rpc';
import { runInBackground } from './background';
import { registerQuitHandler } from './shutdown';
import {
  createDesktopWireOptions,
  registerProviderTokenHandlers,
  wireAccountTelemetry,
} from './wiring';

export async function bootstrap(): Promise<void> {
  if (!prepareElectron()) return;
  registerQuitHandler();

  await app.whenReady();
  await resolveUserEnv();

  if (!(await initializeDatabasePhase())) return;
  await initializeServicesPhase();
  initializeGatewayPhase();
  initializeWindowPhase();
  scheduleBackgroundTasks();
}

function prepareElectron(): boolean {
  if (import.meta.env.DEV) {
    dotenvConfig({ path: '.env.local', override: false });
  }

  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
    if (
      shouldForceLibsecretBackend(process.env, {
        passwordStoreSwitchPresent: app.commandLine.hasSwitch('password-store'),
      })
    ) {
      app.commandLine.appendSwitch('password-store', LIBSECRET_PASSWORD_STORE);
    }
  }

  registerAppScheme();
  initializeFileLogger();
  registerProcessErrorLogging(log);
  registerRendererLogHandler(ipcMain);

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win?.isMinimized()) win.restore();
    win?.focus();
  });

  if (!import.meta.env.DEV && !app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  if (import.meta.env.DEV) {
    try {
      app.dock?.setIcon(devIcon);
    } catch (error) {
      log.warn('Failed to set dock icon:', error);
    }
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  return true;
}

async function initializeDatabasePhase(): Promise<boolean> {
  try {
    await initializeDatabase();
    await runStartupRepairs();
    return true;
  } catch (error) {
    log.error('Failed to initialize database:', error);
    dialog.showErrorBox(
      'Database Initialization Failed',
      `${PRODUCT_NAME} could not start because the database failed to initialize.\n\n${error instanceof Error ? error.message : String(error)}`
    );
    app.quit();
    return false;
  }
}

async function runStartupRepairs(): Promise<void> {
  await resetStaleAcpAgentStatuses();
  await resetStaleTuiAgentStatuses();
  searchService.initialize();

  runInBackground('editor-buffer-prune', () => editorBufferService.pruneStale(), {
    onError: (error) => log.warn('Failed to prune stale editor buffers', { error }),
  });
  runInBackground('browser-partition-cleanup', cleanupLegacyBrowserPartitions, {
    onError: (error) => log.warn('Failed to clean legacy browser partitions', { error }),
  });

  try {
    const [taskRows, projectRows, mementos] = await Promise.all([
      db.select({ id: tasks.id }).from(tasks),
      db.select({ id: projects.id }).from(projects),
      getMementosRuntimeClient(),
    ]);
    const [taskResult, projectResult] = await Promise.all([
      mementos.deleteOrphans({ kind: 'task', validKeys: taskRows.map(({ id }) => id) }),
      mementos.deleteOrphans({ kind: 'project', validKeys: projectRows.map(({ id }) => id) }),
    ]);
    if (!taskResult.success) throw new Error(taskResult.error.message);
    if (!projectResult.success) throw new Error(projectResult.error.message);
    db.run(sql`DELETE FROM kv WHERE key LIKE 'view-state:%'`);
  } catch (error) {
    log.warn('mementos: failed to prune orphaned entries', { error });
  }
}

async function initializeServicesPhase(): Promise<void> {
  try {
    await telemetryService.initialize({
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      installSource: app.isPackaged ? 'dmg' : 'dev',
    });
  } catch (error) {
    log.warn('telemetry init failed:', error);
  }

  wireAccountTelemetry();
  projectSettingsService.initialize();
  pullRequestsRegistration.initialize();
  automationsService.start();
  appService.initialize();
  await appSettingsService.initialize();
  await initializeNotificationService();
  browserWebContentsRegistry.setKeyboardSettings(await appSettingsService.get('keyboard'));
  setBrowserCorsRelaxationSettings(await appSettingsService.get('browser'));
  await promptLibraryService.initialize();
  await operationsService.initialize();
  startLifecycleReconciler(operationsService);
  registerProviderTokenHandlers();
}

function initializeGatewayPhase(): void {
  installDesktopWire(createDesktopWireOptions());

  runInBackground('acp-runtime', () => acpWorker.ready());
  runInBackground('agent-config-runtime', () => agentConfigWorker.ready());
  runInBackground('files-runtime', ensureFilesWorkerReady);
  runInBackground('file-search-runtime', ensureFileSearchWorkerReady);
  runInBackground('git-runtime', ensureGitWorkerReady);
  runInBackground('mementos-runtime', ensureMementosWorkerReady);
  runInBackground('tui-agents-runtime', ensureTuiAgentsWorkerReady);

  acpAgentStatusBridge.initialize();
  tuiAgentStatusBridge.initialize();

  runInBackground('account-session', async () => {
    const result = await emdashAccountService.initialize();
    if (!result.success) {
      log.warn('Failed to load account session token:', result.error);
    }
  });

  registerRPCRouter(rpcRouter, app.isPackaged ? ipcMain : withRpcLogging(ipcMain));
}

function initializeWindowPhase(): void {
  setupAppProtocol(join(app.getAppPath(), 'out', 'renderer'));
  setupApplicationMenu();
  createMainWindow();
}

function scheduleBackgroundTasks(): void {
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
    events.emit(githubAccountsChangedChannel, { reason: 'startup-reconciliation' });
  });

  runInBackground('updates', () => updateService.initialize(), {
    onError: (error) => {
      if (app.isPackaged) {
        log.error('Failed to initialize auto-update service:', error);
      }
    },
  });
}
