import { contextBridge, ipcRenderer } from 'electron';
import type { TerminalSnapshotPayload } from './types/terminalSnapshot';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('app:getAppVersion'),
  getElectronVersion: () => ipcRenderer.invoke('app:getElectronVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
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
  fsWriteFile: (root: string, relPath: string, content: string, mkdirs?: boolean) =>
    ipcRenderer.invoke('fs:write', { root, relPath, content, mkdirs }),
  fsRemove: (root: string, relPath: string) => ipcRenderer.invoke('fs:remove', { root, relPath }),
  // Attachments
  saveAttachment: (args: { workspacePath: string; srcPath: string; subdir?: string }) =>
    ipcRenderer.invoke('fs:save-attachment', args),

  // Project management
  openProject: () => ipcRenderer.invoke('project:open'),
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
  captureTelemetry: (event: 'feature_used' | 'error', properties?: Record<string, any>) =>
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
export interface ElectronAPI {
  // App info
  getVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  // Updater
  checkForUpdates: () => Promise<{ success: boolean; result?: any; error?: string }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  quitAndInstallUpdate: () => Promise<{ success: boolean; error?: string }>;
  openLatestDownload: () => Promise<{ success: boolean; error?: string }>;
  onUpdateEvent: (listener: (data: { type: string; payload?: any }) => void) => () => void;

  // Telemetry (minimal, anonymous)
  captureTelemetry: (
    event: 'feature_used' | 'error',
    properties?: Record<string, any>
  ) => Promise<{ success: boolean; error?: string; disabled?: boolean }>;
  getTelemetryStatus: () => Promise<{
    success: boolean;
    status?: {
      enabled: boolean;
      envDisabled: boolean;
      userOptOut: boolean;
      hasKeyAndHost: boolean;
    };
    error?: string;
  }>;
  setTelemetryEnabled: (
    enabled: boolean
  ) => Promise<{ success: boolean; status?: any; error?: string }>;

  // PTY management
  ptyStart: (opts: {
    id: string;
    cwd?: string;
    shell?: string;
    env?: Record<string, string>;
    cols?: number;
    rows?: number;
    autoApprove?: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  ptyInput: (args: { id: string; data: string }) => void;
  ptyResize: (args: { id: string; cols: number; rows: number }) => void;
  ptyKill: (id: string) => void;
  onPtyData: (id: string, listener: (data: string) => void) => () => void;
  ptyGetSnapshot: (args: { id: string }) => Promise<{
    ok: boolean;
    snapshot?: any;
    error?: string;
  }>;
  ptySaveSnapshot: (args: {
    id: string;
    payload: TerminalSnapshotPayload;
  }) => Promise<{ ok: boolean; error?: string }>;
  ptyClearSnapshot: (args: { id: string }) => Promise<{ ok: boolean }>;
  onPtyExit: (
    id: string,
    listener: (info: { exitCode: number; signal?: number }) => void
  ) => () => void;
  // Worktree management
  worktreeCreate: (args: {
    projectPath: string;
    workspaceName: string;
    projectId: string;
    autoApprove?: boolean;
  }) => Promise<{ success: boolean; worktree?: any; error?: string }>;
  worktreeList: (args: {
    projectPath: string;
  }) => Promise<{ success: boolean; worktrees?: any[]; error?: string }>;
  worktreeRemove: (args: {
    projectPath: string;
    worktreeId: string;
  }) => Promise<{ success: boolean; error?: string }>;
  worktreeStatus: (args: {
    worktreePath: string;
  }) => Promise<{ success: boolean; status?: any; error?: string }>;
  worktreeMerge: (args: {
    projectPath: string;
    worktreeId: string;
  }) => Promise<{ success: boolean; error?: string }>;
  worktreeGet: (args: {
    worktreeId: string;
  }) => Promise<{ success: boolean; worktree?: any; error?: string }>;
  worktreeGetAll: () => Promise<{ success: boolean; worktrees?: any[]; error?: string }>;

  // Project management
  openProject: () => Promise<{ success: boolean; path?: string; error?: string }>;
  getGitInfo: (projectPath: string) => Promise<{
    isGitRepo: boolean;
    remote?: string;
    branch?: string;
    baseRef?: string;
    upstream?: string;
    aheadCount?: number;
    behindCount?: number;
    path?: string;
    rootPath?: string;
    error?: string;
  }>;
  getGitStatus: (workspacePath: string) => Promise<{
    success: boolean;
    changes?: Array<{
      path: string;
      status: string;
      additions: number;
      deletions: number;
      diff?: string;
    }>;
    error?: string;
  }>;
  getFileDiff: (args: { workspacePath: string; filePath: string }) => Promise<{
    success: boolean;
    diff?: { lines: Array<{ left?: string; right?: string; type: 'context' | 'add' | 'del' }> };
    error?: string;
  }>;
  gitCommitAndPush: (args: {
    workspacePath: string;
    commitMessage?: string;
    createBranchIfOnDefault?: boolean;
    branchPrefix?: string;
  }) => Promise<{ success: boolean; branch?: string; output?: string; error?: string }>;
  createPullRequest: (args: {
    workspacePath: string;
    title?: string;
    body?: string;
    base?: string;
    head?: string;
    draft?: boolean;
    web?: boolean;
    fill?: boolean;
  }) => Promise<{ success: boolean; url?: string; output?: string; error?: string }>;
  connectToGitHub: (
    projectPath: string
  ) => Promise<{ success: boolean; repository?: string; branch?: string; error?: string }>;

  // Filesystem helpers
  fsList: (
    root: string,
    opts?: { includeDirs?: boolean; maxEntries?: number }
  ) => Promise<{
    success: boolean;
    items?: Array<{ path: string; type: 'file' | 'dir' }>;
    error?: string;
  }>;
  fsRead: (
    root: string,
    relPath: string,
    maxBytes?: number
  ) => Promise<{
    success: boolean;
    path?: string;
    size?: number;
    truncated?: boolean;
    content?: string;
    error?: string;
  }>;

  onRunEvent: (callback: (event: any) => void) => void;
  removeRunEventListeners: () => void;
  loadContainerConfig: (workspacePath: string) => Promise<
    | { ok: true; config: any; sourcePath: string | null }
    | {
        ok: false;
        error: {
          code:
            | 'INVALID_ARGUMENT'
            | 'INVALID_JSON'
            | 'VALIDATION_FAILED'
            | 'IO_ERROR'
            | 'UNKNOWN'
            | 'PORT_ALLOC_FAILED';
          message: string;
          configPath: string | null;
          configKey: string | null;
        };
      }
  >;
  startContainerRun: (args: {
    workspaceId: string;
    workspacePath: string;
    runId?: string;
    mode?: 'container' | 'host';
  }) => Promise<
    | { ok: true; runId: string; sourcePath: string | null }
    | {
        ok: false;
        error: {
          code:
            | 'INVALID_ARGUMENT'
            | 'INVALID_JSON'
            | 'VALIDATION_FAILED'
            | 'IO_ERROR'
            | 'PORT_ALLOC_FAILED'
            | 'UNKNOWN';
          message: string;
          configPath: string | null;
          configKey: string | null;
        };
      }
  >;
  stopContainerRun: (workspaceId: string) => Promise<{ ok: boolean; error?: string }>;

  // GitHub integration
  githubAuth: () => Promise<{ success: boolean; token?: string; user?: any; error?: string }>;
  githubIsAuthenticated: () => Promise<boolean>;
  githubGetStatus: () => Promise<{ installed: boolean; authenticated: boolean; user?: any }>;
  githubGetUser: () => Promise<any>;
  githubGetRepositories: () => Promise<any[]>;
  githubCloneRepository: (
    repoUrl: string,
    localPath: string
  ) => Promise<{ success: boolean; error?: string }>;
  githubListPullRequests: (
    projectPath: string
  ) => Promise<{ success: boolean; prs?: any[]; error?: string }>;
  githubCreatePullRequestWorktree: (args: {
    projectPath: string;
    projectId: string;
    prNumber: number;
    prTitle?: string;
    workspaceName?: string;
    branchName?: string;
  }) => Promise<{
    success: boolean;
    worktree?: any;
    branchName?: string;
    workspaceName?: string;
    error?: string;
  }>;
  githubLogout: () => Promise<void>;
  githubCheckCLIInstalled: () => Promise<boolean>;
  githubInstallCLI: () => Promise<{ success: boolean; error?: string }>;

  // Database methods
  getProjects: () => Promise<any[]>;
  saveProject: (project: any) => Promise<{ success: boolean; error?: string }>;
  getWorkspaces: (projectId?: string) => Promise<any[]>;
  saveWorkspace: (workspace: any) => Promise<{ success: boolean; error?: string }>;
  deleteProject: (projectId: string) => Promise<{ success: boolean; error?: string }>;
  deleteWorkspace: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;

  // Conversation management
  saveConversation: (conversation: any) => Promise<{ success: boolean; error?: string }>;
  getConversations: (
    workspaceId: string
  ) => Promise<{ success: boolean; conversations?: any[]; error?: string }>;
  getOrCreateDefaultConversation: (
    workspaceId: string
  ) => Promise<{ success: boolean; conversation?: any; error?: string }>;
  saveMessage: (message: any) => Promise<{ success: boolean; error?: string }>;
  getMessages: (
    conversationId: string
  ) => Promise<{ success: boolean; messages?: any[]; error?: string }>;
  deleteConversation: (conversationId: string) => Promise<{ success: boolean; error?: string }>;

  // Host preview (non-container)
  hostPreviewStart: (args: {
    workspaceId: string;
    workspacePath: string;
    script?: string;
    parentProjectPath?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  hostPreviewSetup: (args: {
    workspaceId: string;
    workspacePath: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  hostPreviewStop: (workspaceId: string) => Promise<{ ok: boolean }>;
  onHostPreviewEvent: (
    listener: (data: { type: 'url'; workspaceId: string; url: string }) => void
  ) => () => void;

  // Main-managed browser (WebContentsView)
  browserShow: (
    bounds: { x: number; y: number; width: number; height: number },
    url?: string
  ) => Promise<{ ok: boolean }>;
  browserHide: () => Promise<{ ok: boolean }>;
  browserSetBounds: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<{ ok: boolean }>;
  browserLoadURL: (url: string) => Promise<{ ok: boolean }>;
  browserGoBack: () => Promise<{ ok: boolean }>;
  browserGoForward: () => Promise<{ ok: boolean }>;
  browserReload: () => Promise<{ ok: boolean }>;
  browserOpenDevTools: () => Promise<{ ok: boolean }>;
  onBrowserViewEvent: (listener: (data: any) => void) => () => void;

  // TCP probe (no HTTP requests)
  netProbePorts: (
    host: string,
    ports: number[],
    timeoutMs?: number
  ) => Promise<{ reachable: number[] }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
