import { contextBridge, ipcRenderer } from 'electron';
import type { TerminalSnapshotPayload } from './types/terminalSnapshot';
import type { ElectronAPI as RendererElectronAPI } from '../renderer/types/electron-api';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('app:getAppVersion'),
  getElectronVersion: () => ipcRenderer.invoke('app:getElectronVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  // Path and Dialog helpers
  getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
  showOpenDialog: (options: Electron.OpenDialogOptions) =>
    ipcRenderer.invoke('app:showOpenDialog', options),
  // Updater
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('update:quit-and-install'),
  openLatestDownload: () => ipcRenderer.invoke('update:open-latest'),
  onUpdateEvent: (listener: (data: { type: string; payload?: any }) => void) => {
    const pairs: Array<[string, string]> = [
      ['update:checking', 'checking'],
      ['update:available', 'available'],
      ['update:not-available', 'not-available'],
      ['update:error', 'error'],
      ['update:download-progress', 'download-progress'],
      ['update:downloaded', 'downloaded'],
    ];
    const handlers: Array<() => void> = [];
    for (const [channel, type] of pairs) {
      const wrapped = (_: Electron.IpcRendererEvent, payload: any) => listener({ type, payload });
      ipcRenderer.on(channel, wrapped);
      handlers.push(() => ipcRenderer.removeListener(channel, wrapped));
    }
    return () => handlers.forEach((off) => off());
  },

  // Open a path in a specific app
  openIn: (args: {
    app: 'finder' | 'cursor' | 'vscode' | 'terminal' | 'ghostty' | 'zed' | 'iterm2';
    path: string;
  }) => ipcRenderer.invoke('app:openIn', args),

  // PTY management
  ptyStart: (opts: {
    id: string;
    cwd?: string;
    shell?: string;
    env?: Record<string, string>;
    cols?: number;
    rows?: number;
    autoApprove?: boolean;
    initialPrompt?: string;
  }) => ipcRenderer.invoke('pty:start', opts),
  ptyInput: (args: { id: string; data: string }) => ipcRenderer.send('pty:input', args),
  ptyResize: (args: { id: string; cols: number; rows: number }) =>
    ipcRenderer.send('pty:resize', args),
  ptyKill: (id: string) => ipcRenderer.send('pty:kill', { id }),

  onPtyData: (id: string, listener: (data: string) => void) => {
    const channel = `pty:data:${id}`;
    const wrapped = (_: Electron.IpcRendererEvent, data: string) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  ptyGetSnapshot: (args: { id: string }) => ipcRenderer.invoke('pty:snapshot:get', args),
  ptySaveSnapshot: (args: { id: string; payload: TerminalSnapshotPayload }) =>
    ipcRenderer.invoke('pty:snapshot:save', args),
  ptyClearSnapshot: (args: { id: string }) => ipcRenderer.invoke('pty:snapshot:clear', args),
  onPtyExit: (id: string, listener: (info: { exitCode: number; signal?: number }) => void) => {
    const channel = `pty:exit:${id}`;
    const wrapped = (_: Electron.IpcRendererEvent, info: { exitCode: number; signal?: number }) =>
      listener(info);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onPtyStarted: (listener: (data: { id: string }) => void) => {
    const channel = 'pty:started';
    const wrapped = (_: Electron.IpcRendererEvent, data: { id: string }) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  terminalGetTheme: () => ipcRenderer.invoke('terminal:getTheme'),

  // App settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: any) => ipcRenderer.invoke('settings:update', settings),

  // Worktree management
  worktreeCreate: (args: {
    projectPath: string;
    workspaceName: string;
    projectId: string;
    autoApprove?: boolean;
  }) => ipcRenderer.invoke('worktree:create', args),
  worktreeList: (args: { projectPath: string }) => ipcRenderer.invoke('worktree:list', args),
  worktreeRemove: (args: {
    projectPath: string;
    worktreeId: string;
    worktreePath?: string;
    branch?: string;
  }) => ipcRenderer.invoke('worktree:remove', args),
  worktreeStatus: (args: { worktreePath: string }) => ipcRenderer.invoke('worktree:status', args),
  worktreeMerge: (args: { projectPath: string; worktreeId: string }) =>
    ipcRenderer.invoke('worktree:merge', args),
  worktreeGet: (args: { worktreeId: string }) => ipcRenderer.invoke('worktree:get', args),
  worktreeGetAll: () => ipcRenderer.invoke('worktree:getAll'),

  // Filesystem helpers
  fsList: (root: string, opts?: { includeDirs?: boolean; maxEntries?: number }) =>
    ipcRenderer.invoke('fs:list', { root, ...(opts || {}) }),
  fsRead: (root: string, relPath: string, maxBytes?: number) =>
    ipcRenderer.invoke('fs:read', { root, relPath, maxBytes }),
  pathExists: (targetPath: string) => ipcRenderer.invoke('fs:pathExists', targetPath),
  fsWriteFile: (root: string, relPath: string, content: string, mkdirs?: boolean) =>
    ipcRenderer.invoke('fs:write', { root, relPath, content, mkdirs }),
  fsRemove: (root: string, relPath: string) => ipcRenderer.invoke('fs:remove', { root, relPath }),
  // Attachments
  saveAttachment: (args: { workspacePath: string; srcPath: string; subdir?: string }) =>
    ipcRenderer.invoke('fs:save-attachment', args),

  // Project management
  openProject: () => ipcRenderer.invoke('project:open'),
  cloneProject: (repoUrl: string, repoName?: string, customDestination?: string) =>
    ipcRenderer.invoke('project:clone', repoUrl, repoName, customDestination),
  selectCloneDestination: () => ipcRenderer.invoke('project:selectCloneDestination'),
  getProjectSettings: (projectId: string) =>
    ipcRenderer.invoke('projectSettings:get', { projectId }),
  updateProjectSettings: (args: { projectId: string; baseRef: string }) =>
    ipcRenderer.invoke('projectSettings:update', args),
  fetchProjectBaseRef: (args: { projectId: string; projectPath: string }) =>
    ipcRenderer.invoke('projectSettings:fetchBaseRef', args),
  getGitInfo: (projectPath: string) => ipcRenderer.invoke('git:getInfo', projectPath),
  getGitStatus: (workspacePath: string) => ipcRenderer.invoke('git:get-status', workspacePath),
  getFileDiff: (args: { workspacePath: string; filePath: string }) =>
    ipcRenderer.invoke('git:get-file-diff', args),
  stageFile: (args: { workspacePath: string; filePath: string }) =>
    ipcRenderer.invoke('git:stage-file', args),
  revertFile: (args: { workspacePath: string; filePath: string }) =>
    ipcRenderer.invoke('git:revert-file', args),
  gitCommitAndPush: (args: {
    workspacePath: string;
    commitMessage?: string;
    createBranchIfOnDefault?: boolean;
    branchPrefix?: string;
  }) => ipcRenderer.invoke('git:commit-and-push', args),
  createPullRequest: (args: {
    workspacePath: string;
    title?: string;
    body?: string;
    base?: string;
    head?: string;
    draft?: boolean;
    web?: boolean;
    fill?: boolean;
  }) => ipcRenderer.invoke('git:create-pr', args),
  getPrStatus: (args: { workspacePath: string }) => ipcRenderer.invoke('git:get-pr-status', args),
  getBranchStatus: (args: { workspacePath: string }) =>
    ipcRenderer.invoke('git:get-branch-status', args),
  listRemoteBranches: (args: { projectPath: string; remote?: string }) =>
    ipcRenderer.invoke('git:list-remote-branches', args),
  loadContainerConfig: (workspacePath: string) =>
    ipcRenderer.invoke('container:load-config', { workspacePath }),
  startContainerRun: (args: {
    workspaceId: string;
    workspacePath: string;
    runId?: string;
    mode?: 'container' | 'host';
  }) => ipcRenderer.invoke('container:start-run', args),
  stopContainerRun: (workspaceId: string) =>
    ipcRenderer.invoke('container:stop-run', { workspaceId }),
  inspectContainerRun: (workspaceId: string) =>
    ipcRenderer.invoke('container:inspect-run', { workspaceId }),
  resolveServiceIcon: (args: { service: string; allowNetwork?: boolean; workspacePath?: string }) =>
    ipcRenderer.invoke('icons:resolve-service', args),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  // Telemetry (minimal, anonymous)
  captureTelemetry: (event: string, properties?: Record<string, any>) =>
    ipcRenderer.invoke('telemetry:capture', { event, properties }),
  getTelemetryStatus: () => ipcRenderer.invoke('telemetry:get-status'),
  setTelemetryEnabled: (enabled: boolean) => ipcRenderer.invoke('telemetry:set-enabled', enabled),
  setOnboardingSeen: (flag: boolean) => ipcRenderer.invoke('telemetry:set-onboarding-seen', flag),
  connectToGitHub: (projectPath: string) => ipcRenderer.invoke('github:connect', projectPath),
  onRunEvent: (callback: (event: any) => void) => {
    ipcRenderer.on('run:event', (_, event) => callback(event));
  },
  removeRunEventListeners: () => {
    ipcRenderer.removeAllListeners('run:event');
  },

  // GitHub integration
  githubAuth: () => ipcRenderer.invoke('github:auth'),
  githubCancelAuth: () => ipcRenderer.invoke('github:auth:cancel'),

  // GitHub auth event listeners
  onGithubAuthDeviceCode: (
    callback: (data: {
      userCode: string;
      verificationUri: string;
      expiresIn: number;
      interval: number;
    }) => void
  ) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on('github:auth:device-code', listener);
    return () => ipcRenderer.removeListener('github:auth:device-code', listener);
  },
  onGithubAuthPolling: (callback: (data: { status: string }) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on('github:auth:polling', listener);
    return () => ipcRenderer.removeListener('github:auth:polling', listener);
  },
  onGithubAuthSlowDown: (callback: (data: { newInterval: number }) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on('github:auth:slow-down', listener);
    return () => ipcRenderer.removeListener('github:auth:slow-down', listener);
  },
  onGithubAuthSuccess: (callback: (data: { token: string; user: any }) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on('github:auth:success', listener);
    return () => ipcRenderer.removeListener('github:auth:success', listener);
  },
  onGithubAuthError: (callback: (data: { error: string; message: string }) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on('github:auth:error', listener);
    return () => ipcRenderer.removeListener('github:auth:error', listener);
  },
  onGithubAuthCancelled: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('github:auth:cancelled', listener);
    return () => ipcRenderer.removeListener('github:auth:cancelled', listener);
  },
  onGithubAuthUserUpdated: (callback: (data: { user: any }) => void) => {
    const listener = (_: any, data: any) => callback(data);
    ipcRenderer.on('github:auth:user-updated', listener);
    return () => ipcRenderer.removeListener('github:auth:user-updated', listener);
  },

  githubIsAuthenticated: () => ipcRenderer.invoke('github:isAuthenticated'),
  githubGetStatus: () => ipcRenderer.invoke('github:getStatus'),
  githubGetUser: () => ipcRenderer.invoke('github:getUser'),
  githubGetRepositories: () => ipcRenderer.invoke('github:getRepositories'),
  githubCloneRepository: (repoUrl: string, localPath: string) =>
    ipcRenderer.invoke('github:cloneRepository', repoUrl, localPath),
  githubListPullRequests: (projectPath: string) =>
    ipcRenderer.invoke('github:listPullRequests', { projectPath }),
  githubCreatePullRequestWorktree: (args: {
    projectPath: string;
    projectId: string;
    prNumber: number;
    prTitle?: string;
    workspaceName?: string;
    branchName?: string;
  }) => ipcRenderer.invoke('github:createPullRequestWorktree', args),
  githubLogout: () => ipcRenderer.invoke('github:logout'),
  githubCheckCLIInstalled: () => ipcRenderer.invoke('github:checkCLIInstalled'),
  githubInstallCLI: () => ipcRenderer.invoke('github:installCLI'),
  // GitHub issues
  githubIssuesList: (projectPath: string, limit?: number) =>
    ipcRenderer.invoke('github:issues:list', projectPath, limit),
  githubIssuesSearch: (projectPath: string, searchTerm: string, limit?: number) =>
    ipcRenderer.invoke('github:issues:search', projectPath, searchTerm, limit),
  githubIssueGet: (projectPath: string, number: number) =>
    ipcRenderer.invoke('github:issues:get', projectPath, number),
  // Linear integration
  linearSaveToken: (token: string) => ipcRenderer.invoke('linear:saveToken', token),
  linearCheckConnection: () => ipcRenderer.invoke('linear:checkConnection'),
  linearClearToken: () => ipcRenderer.invoke('linear:clearToken'),
  linearInitialFetch: (limit?: number) => ipcRenderer.invoke('linear:initialFetch', limit),
  linearSearchIssues: (searchTerm: string, limit?: number) =>
    ipcRenderer.invoke('linear:searchIssues', searchTerm, limit),
  // Jira integration
  jiraSaveCredentials: (args: { siteUrl: string; email: string; token: string }) =>
    ipcRenderer.invoke('jira:saveCredentials', args),
  jiraClearCredentials: () => ipcRenderer.invoke('jira:clearCredentials'),
  jiraCheckConnection: () => ipcRenderer.invoke('jira:checkConnection'),
  jiraInitialFetch: (limit?: number) => ipcRenderer.invoke('jira:initialFetch', limit),
  jiraSearchIssues: (searchTerm: string, limit?: number) =>
    ipcRenderer.invoke('jira:searchIssues', searchTerm, limit),
  getProviderStatuses: (opts?: { refresh?: boolean; providers?: string[]; providerId?: string }) =>
    ipcRenderer.invoke('providers:getStatuses', opts ?? {}),
  // Database methods
  getProjects: () => ipcRenderer.invoke('db:getProjects'),
  saveProject: (project: any) => ipcRenderer.invoke('db:saveProject', project),
  getWorkspaces: (projectId?: string) => ipcRenderer.invoke('db:getWorkspaces', projectId),
  saveWorkspace: (workspace: any) => ipcRenderer.invoke('db:saveWorkspace', workspace),
  deleteProject: (projectId: string) => ipcRenderer.invoke('db:deleteProject', projectId),
  deleteWorkspace: (workspaceId: string) => ipcRenderer.invoke('db:deleteWorkspace', workspaceId),

  // Conversation management
  saveConversation: (conversation: any) => ipcRenderer.invoke('db:saveConversation', conversation),
  getConversations: (workspaceId: string) => ipcRenderer.invoke('db:getConversations', workspaceId),
  getOrCreateDefaultConversation: (workspaceId: string) =>
    ipcRenderer.invoke('db:getOrCreateDefaultConversation', workspaceId),
  saveMessage: (message: any) => ipcRenderer.invoke('db:saveMessage', message),
  getMessages: (conversationId: string) => ipcRenderer.invoke('db:getMessages', conversationId),
  deleteConversation: (conversationId: string) =>
    ipcRenderer.invoke('db:deleteConversation', conversationId),

  // Debug helpers
  debugAppendLog: (filePath: string, content: string, options?: { reset?: boolean }) =>
    ipcRenderer.invoke('debug:append-log', filePath, content, options ?? {}),

  // PlanMode strict lock
  planApplyLock: (workspacePath: string) => ipcRenderer.invoke('plan:lock', workspacePath),
  planReleaseLock: (workspacePath: string) => ipcRenderer.invoke('plan:unlock', workspacePath),
  onPlanEvent: (
    listener: (data: {
      type: 'write_blocked' | 'remove_blocked';
      root: string;
      relPath: string;
      code?: string;
      message?: string;
    }) => void
  ) => {
    const channel = 'plan:event';
    const wrapped = (_: Electron.IpcRendererEvent, data: any) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  onProviderStatusUpdated: (listener: (data: { providerId: string; status: any }) => void) => {
    const channel = 'provider:status-updated';
    const wrapped = (_: Electron.IpcRendererEvent, data: any) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  // Host preview (non-container)
  hostPreviewStart: (args: {
    workspaceId: string;
    workspacePath: string;
    script?: string;
    parentProjectPath?: string;
  }) => ipcRenderer.invoke('preview:host:start', args),
  hostPreviewSetup: (args: { workspaceId: string; workspacePath: string }) =>
    ipcRenderer.invoke('preview:host:setup', args),
  hostPreviewStop: (workspaceId: string) => ipcRenderer.invoke('preview:host:stop', workspaceId),
  hostPreviewStopAll: (exceptId?: string) => ipcRenderer.invoke('preview:host:stopAll', exceptId),
  onHostPreviewEvent: (listener: (data: any) => void) => {
    const channel = 'preview:host:event';
    const wrapped = (_: Electron.IpcRendererEvent, data: any) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  // Main-managed browser (WebContentsView)
  browserShow: (bounds: { x: number; y: number; width: number; height: number }, url?: string) =>
    ipcRenderer.invoke('browser:view:show', { ...bounds, url }),
  browserHide: () => ipcRenderer.invoke('browser:view:hide'),
  browserSetBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('browser:view:setBounds', bounds),
  browserLoadURL: (url: string, forceReload?: boolean) =>
    ipcRenderer.invoke('browser:view:loadURL', url, forceReload),
  browserGoBack: () => ipcRenderer.invoke('browser:view:goBack'),
  browserGoForward: () => ipcRenderer.invoke('browser:view:goForward'),
  browserReload: () => ipcRenderer.invoke('browser:view:reload'),
  browserOpenDevTools: () => ipcRenderer.invoke('browser:view:openDevTools'),
  browserClear: () => ipcRenderer.invoke('browser:view:clear'),
  onBrowserViewEvent: (listener: (data: any) => void) => {
    const channel = 'browser:view:event';
    const wrapped = (_: Electron.IpcRendererEvent, data: any) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  // Lightweight TCP probe for localhost ports to avoid noisy fetches
  netProbePorts: (host: string, ports: number[], timeoutMs?: number) =>
    ipcRenderer.invoke('net:probePorts', host, ports, timeoutMs),
});

// Type definitions for the exposed API
export type ElectronAPI = RendererElectronAPI;

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
