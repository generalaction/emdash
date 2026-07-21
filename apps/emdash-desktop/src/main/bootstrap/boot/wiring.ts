import { providerTokenRegistry } from '@core/features/account/api/node/provider-token-registry';
import type { EmdashAccountService } from '@core/features/account/node/services/emdash-account-service';
import { GitHubAuthServerAdapter } from '@core/features/github/node/accounts/github-auth-server-adapter';
import { taskProvisionEvents } from '@core/features/tasks/node/task-provision-events';
import { provisionWorkspaceErrorToWorkspaceError } from '@core/features/workspaces/node/wire-controller';
import { appOperations } from '@main/core/app/controller';
import {
  ensureAgentDependenciesProbed,
  getDependencyManager,
} from '@main/core/dependencies/dependency-managers';
import { providerAccountRegistry } from '@main/core/provider-accounts/provider-account-registry-instance';
import { getTerminalColorEnv } from '@main/core/terminal-shell/color-env';
import {
  getLocalTerminalShellAvailability,
  resolveTerminalShellWithSystemFallback,
} from '@main/core/terminal-shell/resolver';
import { withCompensation } from '@main/core/utils/compensation';
import { legacyPortOperations } from '@main/db/legacy-port/controller';
import type { InstallDesktopWireOptions } from '@main/gateway/desktop-wire';
import {
  getAutomationsRuntimeClient,
  getFilesRuntimeClient,
  getGitRuntimeClient,
  getMementosRuntimeClient,
  getPullRequestsRuntimeClient,
  getWorkspaceRuntimeClient,
} from '@main/gateway/desktop-workers';
import { setBrowserCorsRelaxationSettings } from '@main/host/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/host/browser/browser-webcontents-registry';
import { browserOperations } from '@main/host/browser/controller';
import { updateOperations } from '@main/host/updates/controller-operations';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type { BootContext } from './types';

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

export function createDesktopWireOptions(context: BootContext): InstallDesktopWireOptions {
  const taskService = requireBootService(context.taskService, 'task service');
  const github = requireBootService(context.githubServices, 'GitHub services');
  return {
    accountService: requireBootService(context.accountService, 'account service'),
    agentDependencies: {
      ensureAgentDependenciesProbed,
      getDependencyManager,
    },
    appSettings: requireBootService(context.appSettingsService, 'app settings service'),
    automations: requireBootService(context.automationsService, 'automations service'),
    browserOperations,
    compensation: withCompensation,
    db: requireBootService(context.db, 'app database'),
    editorBuffer: requireBootService(context.editorBufferService, 'editor buffer service'),
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
    issueProviders: requireBootService(context.issueProviders, 'issue provider registry'),
    legacyPortOperations,
    logger: log,
    notifications: requireBootService(context.notificationService, 'notification service'),
    operations: requireBootService(context.operations, 'operations engine'),
    promptLibrary: requireBootService(context.promptLibraryService, 'prompt library service'),
    projects: requireBootService(context.projectManager, 'project manager'),
    projectSettings: requireBootService(context.projectSettingsService, 'project settings service'),
    providerSettings: requireBootService(
      context.providerOverrideSettings,
      'provider settings service'
    ),
    search: requireBootService(context.searchService, 'search service'),
    runtimeClients: {
      getAutomationsRuntimeClient,
      getFilesRuntimeClient,
      getGitRuntimeClient,
      getMementosRuntimeClient,
      getPullRequestsRuntimeClient,
      getWorkspaceRuntimeClient,
    },
    settingsRuntime: {
      setKeyboardSettings: (settings) => browserWebContentsRegistry.setKeyboardSettings(settings),
      setBrowserSettings: setBrowserCorsRelaxationSettings,
    },
    telemetry: telemetryService,
    taskService,
    taskSessions: requireBootService(context.taskSessionManager, 'task session manager'),
    terminalShell: {
      getColorEnv: getTerminalColorEnv,
      getLocalAvailability: getLocalTerminalShellAvailability,
      resolveWithSystemFallback: resolveTerminalShellWithSystemFallback,
    },
    updateOperations,
    workspaceIdentity: requireBootService(context.workspaceIdentity, 'workspace identity service'),
    workspacePlacement: requireBootService(context.workspacePlacement, 'workspace placement'),
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

function requireBootService<T>(service: T | undefined, name: string): T {
  if (!service) throw new Error(`${name} was not initialized before the gateway phase`);
  return service;
}
