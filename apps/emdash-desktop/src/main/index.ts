import './app/configure-app-identity';
import './core/telemetry/automation-telemetry';
import { join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { sql } from 'drizzle-orm';
import { app, BrowserWindow, dialog, ipcMain, systemPreferences } from 'electron';
import devIcon from '@/assets/images/emdash/emdash-dev.png?asset';
import { initializeNotificationService } from '@root/src/core/services/notifications/node';
import { PRODUCT_NAME } from '@shared/app-identity';
import { githubAccountsChangedChannel } from '@shared/events/githubEvents';
import { registerRPCRouter } from '@shared/lib/ipc/rpc';
import { LIBSECRET_PASSWORD_STORE, shouldForceLibsecretBackend } from './app/linux-secret-storage';
import { setupApplicationMenu } from './app/menu';
import { registerAppScheme, setupAppProtocol } from './app/protocol';
import { registerQuitHandler } from './app/shutdown';
import { createMainWindow } from './app/window';
import { providerTokenRegistry } from './core/account/provider-token-registry';
import { emdashAccountService } from './core/account/services/emdash-account-service';
import { acpAgentStatusBridge } from './core/acp/agent-status-bridge';
import { tuiAgentStatusBridge } from './core/agent-status/tui-agent-status-bridge';
import { appService } from './core/app/service';
import { automationsService } from './core/automations/automations-service';
import { cleanupLegacyBrowserPartitions } from './core/browser/browser-partition-cleanup';
import { setBrowserCorsRelaxationSettings } from './core/browser/browser-profile-session';
import { browserWebContentsRegistry } from './core/browser/browser-webcontents-registry';
import { resetStaleAcpAgentStatuses } from './core/conversations/reset-stale-acp-agent-statuses';
import { resetStaleTuiAgentStatuses } from './core/conversations/reset-stale-tui-agent-statuses';
import { localDependencyManager } from './core/dependencies/dependency-managers';
import { editorBufferService } from './core/editor/editor-buffer-service';
import { githubAccountReconciliationService } from './core/github/accounts/github-account-reconciliation-instance';
import { GitHubAuthServerAdapter } from './core/github/accounts/github-auth-server-adapter';
import { startLifecycleReconciler } from './core/operations/lifecycle-reconciler';
import { operationsService } from './core/operations/operations-service';
import { projectSettingsService } from './core/projects/settings/project-settings-service';
import { promptLibraryService } from './core/prompt-library/service';
import { providerAccountRegistry } from './core/provider-accounts/provider-account-registry-instance';
import { searchService } from './core/search/search-service';
import { appSettingsService } from './core/settings/settings-service';
import { taskService } from './core/tasks/task-service';
import { updateService } from './core/updates/update-service';
import { installDesktopWire } from './core/wire-workers/desktop-wire';
import {
  acpWorker,
  agentConfigWorker,
  ensureFileSearchWorkerReady,
  ensureFilesWorkerReady,
  ensureGitWorkerReady,
  ensureMementosWorkerReady,
  ensureTuiAgentsWorkerReady,
  getMementosRuntimeClient,
} from './core/wire-workers/desktop-workers';
import { pullRequestsRegistration } from './core/wire-workers/pull-requests-registration';
import { provisionWorkspaceErrorToWorkspaceError } from './core/workspaces/wire-controller';
import { db } from './db/client';
import { initializeDatabase } from './db/initialize';
import { projects, tasks } from './db/schema';
import { events } from './lib/events';
import {
  initializeFileLogger,
  registerProcessErrorLogging,
  registerRendererLogHandler,
} from './lib/file-logger';
import { log } from './lib/logger';
import { withRpcLogging } from './lib/rpc-logging';
import { telemetryService } from './lib/telemetry';
import { rpcRouter } from './rpc';
import { resolveUserEnv } from './utils/userEnv';

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
  process.exit(0);
}

if (import.meta.env.DEV) {
  try {
    app.dock?.setIcon(devIcon);
  } catch (err) {
    log.warn('Failed to set dock icon:', err);
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

void app.whenReady().then(async () => {
  await resolveUserEnv();

  try {
    await initializeDatabase();
    await resetStaleAcpAgentStatuses();
    await resetStaleTuiAgentStatuses();
    searchService.initialize();
    void editorBufferService.pruneStale();
    void cleanupLegacyBrowserPartitions();
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
    } catch (e: unknown) {
      log.warn('mementos: failed to prune orphaned entries', { error: e });
    }
  } catch (error) {
    log.error('Failed to initialize database:', error);
    dialog.showErrorBox(
      'Database Initialization Failed',
      `${PRODUCT_NAME} could not start because the database failed to initialize.\n\n${error instanceof Error ? error.message : String(error)}`
    );
    app.quit();
    return;
  }

  try {
    await telemetryService.initialize({ installSource: app.isPackaged ? 'dmg' : 'dev' });
  } catch (e) {
    log.warn('telemetry init failed:', e);
  }

  emdashAccountService.on('accountChanged', (username, userId, email) => {
    void telemetryService.identify(username, userId, email);
  });
  emdashAccountService.on('accountCleared', () => {
    telemetryService.clearIdentity();
  });

  projectSettingsService.initialize();
  pullRequestsRegistration.initialize();
  automationsService.start();
  appService.initialize();
  await appSettingsService.initialize();
  await initializeNotificationService();
  browserWebContentsRegistry.setKeyboardSettings(await appSettingsService.get('keyboard'));
  setBrowserCorsRelaxationSettings(await appSettingsService.get('browser'));
  await promptLibraryService.initialize();
  installDesktopWire({
    async provisionTask(taskId) {
      const result = await taskService.provisionWorkspace(taskId);
      return result.success
        ? result
        : { success: false, error: provisionWorkspaceErrorToWorkspaceError(result.error) };
    },
    onTaskWorkspaceReady(handler) {
      return taskService.on('task:workspace-ready', (_taskId, result) => handler(_taskId, result));
    },
  });
  await operationsService.initialize();
  startLifecycleReconciler(operationsService);
  acpWorker.ready().catch((e) => {
    log.error('Failed to start ACP runtime process:', e);
  });
  agentConfigWorker.ready().catch((e) => {
    log.error('Failed to start agent-config runtime process:', e);
  });
  ensureFilesWorkerReady().catch((e) => {
    log.error('Failed to start Files runtime process:', e);
  });
  ensureFileSearchWorkerReady().catch((e) => {
    log.error('Failed to start file-search runtime process:', e);
  });
  ensureGitWorkerReady().catch((e) => {
    log.error('Failed to start Git runtime process:', e);
  });
  ensureMementosWorkerReady().catch((e) => {
    log.error('Failed to start mementos runtime process:', e);
  });
  ensureTuiAgentsWorkerReady().catch((e) => {
    log.error('Failed to start TUI agents runtime process:', e);
  });
  acpAgentStatusBridge.initialize();
  tuiAgentStatusBridge.initialize();

  emdashAccountService
    .initialize()
    .then((result) => {
      if (!result.success) {
        log.warn('Failed to load account session token:', result.error);
      }
    })
    .catch((e: unknown) => {
      log.warn('Account session initialization threw unexpectedly:', e);
    });

  const githubAuthServerAdapter = new GitHubAuthServerAdapter(providerAccountRegistry);
  providerTokenRegistry.register('github', (payload) =>
    githubAuthServerAdapter.storeOAuthToken(payload)
  );

  registerRPCRouter(rpcRouter, app.isPackaged ? ipcMain : withRpcLogging(ipcMain));

  localDependencyManager.snapshot
    .mutate('refresh', { key: undefined, input: {} })
    .catch((e: unknown) => {
      log.error('Failed to probe dependencies:', e);
    });

  if (process.platform === 'darwin') {
    if (systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
      systemPreferences
        .askForMediaAccess('microphone')
        .then((granted) => {
          log.info('Microphone access request resolved:', { granted });
        })
        .catch((e) => {
          log.warn('Failed to request microphone access:', e);
        });
    }
  }

  setupAppProtocol(join(app.getAppPath(), 'out', 'renderer'));
  setupApplicationMenu();
  createMainWindow();

  githubAccountReconciliationService
    .reconcileAtStartup()
    .then(() => {
      events.emit(githubAccountsChangedChannel, { reason: 'startup-reconciliation' });
    })
    .catch((e) => {
      log.warn('Failed to reconcile GitHub accounts at startup:', e);
    });

  try {
    await updateService.initialize();
  } catch (error) {
    if (app.isPackaged) {
      log.error('Failed to initialize auto-update service:', error);
    }
  }
});

registerQuitHandler();
