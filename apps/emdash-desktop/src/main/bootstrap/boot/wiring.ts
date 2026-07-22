import { providerTokenRegistry } from '@core/features/account/api/node/provider-token-registry';
import type { EmdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import { GitHubAuthServerAdapter } from '@core/features/github/node/accounts/github-auth-server-adapter';
import { taskProvisionEvents } from '@core/features/tasks/node/task-provision-events';
import { provisionWorkspaceErrorToWorkspaceError } from '@core/features/workspaces/node/wire-controller';
import type { DesktopControllerContext } from '@core/manifests/node/controllers';
import { appOperations } from '@main/core/app/controller';
import {
  createDependencyManagerResolver,
  ensureAgentDependenciesProbed,
} from '@main/core/dependencies/dependency-managers';
import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { getTerminalColorEnv } from '@main/core/terminal-shell/color-env';
import {
  getLocalTerminalShellAvailability,
  resolveTerminalShellWithSystemFallback,
} from '@main/core/terminal-shell/resolver';
import { withCompensation } from '@main/core/utils/compensation';
import { legacyPortOperations } from '@main/db/legacy-port/controller';
import type { DesktopRuntimes } from '@main/gateway/desktop-runtimes';
import { setBrowserCorsRelaxationSettings } from '@main/host/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import { browserOperations } from '@main/host/browser/controller';
import { updateOperations } from '@main/host/updates/controller-operations';
import { applyNativeTheme } from '@main/host/window';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type { DatabaseBundle } from './phases/database';
import type { ServicesBundle } from './phases/services';

export function wireAccountTelemetry(accountService: EmdashAccountService): void {
  accountService.on('accountChanged', (username, userId, email) => {
    void telemetryService.identify(username, userId, email);
  });
  accountService.on('accountCleared', () => {
    telemetryService.clearIdentity();
  });
}

export function registerProviderTokenHandlers(): void {
  const githubAuthServerAdapter = new GitHubAuthServerAdapter(providerAccountRegistry);
  providerTokenRegistry.register('github', (payload) =>
    githubAuthServerAdapter.storeOAuthToken(payload)
  );
}

export type DesktopControllerOptions = Omit<
  DesktopControllerContext,
  'remoteMachine' | 'runtimes' | 'scope' | 'ssh'
>;

export function createDesktopWireOptions(
  database: DatabaseBundle,
  services: ServicesBundle,
  runtimes: DesktopRuntimes
): DesktopControllerOptions {
  const taskService = services.taskService;
  const github = services.github;
  const getDependencyManager = createDependencyManagerResolver(runtimes.clients.hostDependencies);
  return {
    accountService: services.account,
    agentDependencies: {
      ensureAgentDependenciesProbed,
      getDependencyManager,
    },
    appSettings: database.appSettings,
    automations: services.automations,
    browserOperations,
    compensation: withCompensation,
    db: database.db,
    editorBuffer: database.editorBuffer,
    github: {
      accountService: github.account,
      deviceFlowService: github.deviceFlow,
      repositoryService: github.repositories,
    },
    hostOperations: {
      openExternal: ({ url }) => appOperations.openExternal(url),
      openPath: ({ path }) => appOperations.openPath(path),
      showWorkspaceItemInFolder: (input) => appOperations.showWorkspaceItemInFolder(input),
      readUserFile: ({ path }) => appOperations.readUserFile(path),
      writeRendererLog: (input) => appOperations.writeRendererLog(input),
      clipboardWriteText: ({ text }) => appOperations.clipboardWriteText(text),
      persistDroppedBlob: (input) => appOperations.persistDroppedBlob(input),
      persistClipboardImage: () => appOperations.persistClipboardImage(),
      showTerminalContextMenu: (input) => appOperations.showTerminalContextMenu(input),
      setMenuKeybindings: (input) => appOperations.setMenuKeybindings(input),
      quit: () => appOperations.quit(),
      resolveQuitConfirmation: (input) => appOperations.resolveQuitConfirmation(input),
      ackShutdownFlush: () => appOperations.ackShutdownFlush(),
      shutdownReady: () => appOperations.shutdownReady(),
      openIn: (input) => appOperations.openIn(input),
      checkInstalledApps: () => appOperations.checkInstalledApps(),
      listInstalledFonts: (input) => appOperations.listInstalledFonts(input),
      openSelectDirectoryDialog: (input) => appOperations.openSelectDirectoryDialog(input),
      openSelectAudioFileDialog: (input) => appOperations.openSelectAudioFileDialog(input),
      saveTextFile: (input) => appOperations.saveTextFile(input),
      readAudioFileDataUrl: ({ filePath }) => appOperations.readAudioFileDataUrl(filePath),
      minimizeWindow: () => appOperations.minimizeWindow(),
      toggleMaximizeWindow: () => appOperations.toggleMaximizeWindow(),
      closeWindow: () => appOperations.closeWindow(),
      isWindowMaximized: () => appOperations.isWindowMaximized(),
      getAppVersion: () => appOperations.getAppVersion(),
      getElectronVersion: () => appOperations.getElectronVersion(),
      getPlatform: () => appOperations.getPlatform(),
      getPlatformDisplayName: () => appOperations.getPlatformDisplayName(),
      getDiagnosticLogAttachment: () => appOperations.getDiagnosticLogAttachment(),
    },
    issueProviders: services.issueProviders,
    legacyPortOperations,
    logger: log,
    notifications: services.notifications,
    operations: services.operations,
    promptLibrary: services.promptLibrary,
    projects: services.projects,
    projectSettings: services.projectSettings,
    providerSettings: services.providerSettings,
    search: services.search,
    runtimeClients: {
      getFilesRuntimeClient: async () => runtimes.clients.files,
      getMementosRuntimeClient: async () => runtimes.clients.mementos,
      getPullRequestsRuntimeClient: async () => runtimes.clients.pullRequests,
      getWorkspaceRuntimeClient: async () => runtimes.clients.workspace,
    },
    settingsRuntime: {
      setKeyboardSettings: (settings) => browserWebContentsRegistry.setKeyboardSettings(settings),
      setBrowserSettings: setBrowserCorsRelaxationSettings,
      setTheme: applyNativeTheme,
    },
    telemetry: telemetryService,
    taskService,
    taskSessions: services.taskSessions,
    terminalShell: {
      getColorEnv: getTerminalColorEnv,
      getLocalAvailability: getLocalTerminalShellAvailability,
      resolveWithSystemFallback: resolveTerminalShellWithSystemFallback,
    },
    updateOperations,
    workspaceIdentity: database.workspaceIdentity,
    workspacePlacement: services.workspacePlacement,
    workspaces: {
      async provisionTask(taskId) {
        const result = await taskService.provisionWorkspace(taskId);
        return result.success
          ? result
          : { success: false, error: provisionWorkspaceErrorToWorkspaceError(result.error) };
      },
      onTaskProvisionProgress(handler) {
        return taskProvisionEvents.on('progress', handler);
      },
      onTaskWorkspaceReady(handler) {
        return taskService.on('task:workspace-ready', (_taskId, result) =>
          handler(_taskId, result)
        );
      },
    },
  };
}
