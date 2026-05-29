import { createServer, request } from 'node:http';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import dockIcon from '@/assets/images/emdash/icon-dock.png?asset';
import { APP_NAME_LOWER, PRODUCT_NAME } from '@shared/app-identity';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { setupApplicationMenu } from './app/menu';
import { registerAppScheme, setupAppProtocol } from './app/protocol';
import { createMainWindow } from './app/window';
import { providerTokenRegistry } from './core/account/provider-token-registry';
import { emdashAccountService } from './core/account/services/emdash-account-service';
import { agentHookService } from './core/agent-hooks/agent-hook-service';
import { appService } from './core/app/service';
import { localDependencyManager } from './core/dependencies/dependency-manager';
import { editorBufferService } from './core/editor/editor-buffer-service';
import { gitWatcherRegistry } from './core/git/git-watcher-registry';
import { githubConnectionService } from './core/github/services/github-connection-service';
import { projectManager } from './core/projects/project-manager';
import { projectSettingsService } from './core/projects/settings/project-settings-service';
import { promptLibraryService } from './core/prompt-library/service';
import { prSyncScheduler } from './core/pull-requests/pr-sync-scheduler';
import {
  reconcileResourceSampler,
  stopResourceSampler,
} from './core/resource-monitor/resource-sampler';
import { searchService } from './core/search/search-service';
import { workspaceFileIndexService } from './core/search/workspace-file-index-service';
import { appSettingsService } from './core/settings/settings-service';
import { updateService } from './core/updates/update-service';
import { viewStateService } from './core/view-state/view-state-service';
import { initializeDatabase } from './db/initialize';
import {
  initializeFileLogger,
  registerProcessErrorLogging,
  registerRendererLogHandler,
} from './lib/file-logger';
import { log } from './lib/logger';
import { telemetryService } from './lib/telemetry';
import { rpcRouter } from './rpc';
import { resolveUserEnv } from './utils/userEnv';

if (import.meta.env.DEV) {
  dotenvConfig({ path: '.env.local', override: false });
}

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
}

registerAppScheme();

app.setName(PRODUCT_NAME);
app.setPath('userData', join(app.getPath('appData'), 'emdash'));
initializeFileLogger();
registerProcessErrorLogging(log);
registerRendererLogHandler(ipcMain);

const appDeepLinkScheme = `${APP_NAME_LOWER}:`;
const DEV_DEEP_LINK_BRIDGE_PORT = 49375;
let devDeepLinkBridge: Server | null = null;

function findDeepLinkUrl(args: string[]): string | undefined {
  return args.find((arg) => arg.toLowerCase().startsWith(appDeepLinkScheme));
}

const initialDeepLinkUrl = findDeepLinkUrl(process.argv);

function forwardDeepLinkToDevInstance(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ url });
    const req = request(
      {
        hostname: '127.0.0.1',
        port: DEV_DEEP_LINK_BRIDGE_PORT,
        path: '/deep-link',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        timeout: 500,
      },
      (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300);
      }
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end(body);
  });
}

function startDevDeepLinkBridge(): void {
  if (!import.meta.env.DEV || devDeepLinkBridge) return;

  devDeepLinkBridge = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/deep-link') {
      res.writeHead(404).end();
      return;
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 8_192) req.destroy();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body) as { url?: unknown };
        if (typeof payload.url !== 'string' || !payload.url.startsWith(appDeepLinkScheme)) {
          res.writeHead(400).end();
          return;
        }

        if (!handleDeepLinkUrl(payload.url)) {
          res.writeHead(422).end();
          return;
        }

        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
  });

  devDeepLinkBridge.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      log.warn(
        'Dev deep link bridge port is already in use; deeplinks may target another dev instance.'
      );
    } else {
      log.warn('Dev deep link bridge failed:', error);
    }
    devDeepLinkBridge = null;
  });

  devDeepLinkBridge.listen(DEV_DEEP_LINK_BRIDGE_PORT, '127.0.0.1');
}

if (import.meta.env.DEV && initialDeepLinkUrl) {
  const forwarded = await forwardDeepLinkToDevInstance(initialDeepLinkUrl);
  if (forwarded) {
    app.quit();
    process.exit(0);
  }
}

function registerDeepLinkProtocol(): void {
  try {
    if (import.meta.env.DEV) {
      app.setAsDefaultProtocolClient(
        APP_NAME_LOWER,
        process.execPath,
        process.argv[1] ? [process.argv[1]] : []
      );
    } else {
      app.setAsDefaultProtocolClient(APP_NAME_LOWER);
    }
  } catch (error) {
    log.warn('Failed to register app deep link protocol:', error);
  }
}

function handleDeepLinkUrl(url: string): boolean {
  if (!appService.handleDeepLink(url)) return false;

  if (!app.isReady()) return true;

  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }

  const win = BrowserWindow.getAllWindows()[0];
  if (win?.isMinimized()) win.restore();
  win?.focus();
  return true;
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLinkUrl(url);
});

app.on('second-instance', (_event, commandLine) => {
  const deepLinkUrl = findDeepLinkUrl(commandLine);
  if (deepLinkUrl) {
    handleDeepLinkUrl(deepLinkUrl);
    return;
  }

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
    app.dock?.setIcon(dockIcon);
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
  registerDeepLinkProtocol();
  await resolveUserEnv();

  try {
    await initializeDatabase();
    searchService.initialize();
    workspaceFileIndexService.initialize();
    void editorBufferService.pruneStale();
    try {
      viewStateService.pruneOrphans();
    } catch (e: unknown) {
      log.warn('view-state: failed to prune orphaned entries', { error: e });
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

  gitWatcherRegistry.initialize();
  projectSettingsService.initialize();
  prSyncScheduler.initialize();
  appService.initialize();
  startDevDeepLinkBridge();
  await appSettingsService.initialize();
  await promptLibraryService.initialize();

  agentHookService.initialize().catch((e) => {
    log.error('Failed to start agent event service:', e);
  });

  emdashAccountService.loadSessionToken().catch((e) => {
    log.warn('Failed to load account session token:', e);
  });

  providerTokenRegistry.register('github', (token) =>
    githubConnectionService.storeToken(token, 'emdash_oauth')
  );

  registerRPCRouter(rpcRouter, ipcMain);

  void reconcileResourceSampler();

  localDependencyManager.probeAll().catch((e) => {
    log.error('Failed to probe dependencies:', e);
  });

  setupAppProtocol(join(app.getAppPath(), 'out', 'renderer'));
  setupApplicationMenu();
  createMainWindow();
  if (initialDeepLinkUrl) handleDeepLinkUrl(initialDeepLinkUrl);

  try {
    await updateService.initialize();
  } catch (error) {
    if (app.isPackaged) {
      log.error('Failed to initialize auto-update service:', error);
    }
  }
});

app.on('before-quit', (event) => {
  event.preventDefault();
  telemetryService.capture('app_closed');
  void telemetryService.dispose().finally(() => {
    agentHookService.dispose();
    stopResourceSampler();
    updateService.dispose();
    prSyncScheduler.dispose();
    devDeepLinkBridge?.close();
    devDeepLinkBridge = null;
    void gitWatcherRegistry.dispose();
    void projectManager.dispose().catch((e) => {
      log.error('Failed to shutdown project manager:', e);
    });
    app.exit(0);
  });
});
