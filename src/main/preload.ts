import { contextBridge, ipcRenderer } from 'electron';

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
  onPtyHistory: (id: string, listener: (data: string) => void) => {
    const channel = `pty:history:${id}`;
    const wrapped = (_: Electron.IpcRendererEvent, data: string) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
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
  worktreeCreate: (args: { projectPath: string; workspaceName: string; projectId: string }) =>
    ipcRenderer.invoke('worktree:create', args),
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
  loadContainerConfig: (workspacePath: string) =>
    ipcRenderer.invoke('container:load-config', { workspacePath }),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  // Telemetry (minimal, anonymous)
  captureTelemetry: (event: 'feature_used' | 'error', properties?: Record<string, any>) =>
    ipcRenderer.invoke('telemetry:capture', { event, properties }),
  getTelemetryStatus: () => ipcRenderer.invoke('telemetry:get-status'),
  setTelemetryEnabled: (enabled: boolean) => ipcRenderer.invoke('telemetry:set-enabled', enabled),
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
  // Linear integration
  linearSaveToken: (token: string) => ipcRenderer.invoke('linear:saveToken', token),
  linearCheckConnection: () => ipcRenderer.invoke('linear:checkConnection'),
  linearClearToken: () => ipcRenderer.invoke('linear:clearToken'),
  linearInitialFetch: (limit?: number) => ipcRenderer.invoke('linear:initialFetch', limit),
  linearSearchIssues: (searchTerm: string, limit?: number) =>
    ipcRenderer.invoke('linear:searchIssues', searchTerm, limit),
  getCliProviders: () => ipcRenderer.invoke('connections:getCliProviders'),
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

  // Codex integration
  codexCheckInstallation: () => ipcRenderer.invoke('codex:check-installation'),
  codexCreateAgent: (workspaceId: string, worktreePath: string) =>
    ipcRenderer.invoke('codex:create-agent', workspaceId, worktreePath),
  codexSendMessage: (workspaceId: string, message: string) =>
    ipcRenderer.invoke('codex:send-message', workspaceId, message),
  codexSendMessageStream: (workspaceId: string, message: string, conversationId?: string) =>
    ipcRenderer.invoke('codex:send-message-stream', workspaceId, message, conversationId),
  codexStopStream: (workspaceId: string) => ipcRenderer.invoke('codex:stop-stream', workspaceId),
  codexGetStreamTail: (workspaceId: string) =>
    ipcRenderer.invoke('codex:get-stream-tail', workspaceId),
  codexGetAgentStatus: (workspaceId: string) =>
    ipcRenderer.invoke('codex:get-agent-status', workspaceId),
  codexGetAllAgents: () => ipcRenderer.invoke('codex:get-all-agents'),
  codexRemoveAgent: (workspaceId: string) => ipcRenderer.invoke('codex:remove-agent', workspaceId),
  codexGetInstallationInstructions: () => ipcRenderer.invoke('codex:get-installation-instructions'),

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

  // Streaming event listeners
  onCodexStreamOutput: (
    listener: (data: {
      workspaceId: string;
      output: string;
      agentId: string;
      conversationId?: string;
    }) => void
  ) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      data: { workspaceId: string; output: string; agentId: string; conversationId?: string }
    ) => listener(data);
    ipcRenderer.on('codex:stream-output', wrapped);
    return () => ipcRenderer.removeListener('codex:stream-output', wrapped);
  },
  onCodexStreamError: (
    listener: (data: {
      workspaceId: string;
      error: string;
      agentId: string;
      conversationId?: string;
    }) => void
  ) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      data: { workspaceId: string; error: string; agentId: string; conversationId?: string }
    ) => listener(data);
    ipcRenderer.on('codex:stream-error', wrapped);
    return () => ipcRenderer.removeListener('codex:stream-error', wrapped);
  },
  onCodexStreamComplete: (
    listener: (data: {
      workspaceId: string;
      exitCode: number;
      agentId: string;
      conversationId?: string;
    }) => void
  ) => {
    const wrapped = (
      _: Electron.IpcRendererEvent,
      data: { workspaceId: string; exitCode: number; agentId: string; conversationId?: string }
    ) => listener(data);
    ipcRenderer.on('codex:stream-complete', wrapped);
    return () => ipcRenderer.removeListener('codex:stream-complete', wrapped);
  },

  // Generic agent integration (multi-provider)
  agentCheckInstallation: (providerId: 'codex' | 'claude') =>
    ipcRenderer.invoke('agent:check-installation', providerId),
  agentGetInstallationInstructions: (providerId: 'codex' | 'claude') =>
    ipcRenderer.invoke('agent:get-installation-instructions', providerId),
  agentSendMessageStream: (args: {
    providerId: 'codex' | 'claude';
    workspaceId: string;
    worktreePath: string;
    message: string;
    conversationId?: string;
  }) => ipcRenderer.invoke('agent:send-message-stream', args),
  agentStopStream: (args: { providerId: 'codex' | 'claude'; workspaceId: string }) =>
    ipcRenderer.invoke('agent:stop-stream', args),
  onAgentStreamOutput: (
    listener: (data: {
      providerId: 'codex' | 'claude';
      workspaceId: string;
      output?: string;
      error?: string;
      agentId?: string;
      conversationId?: string;
    }) => void
  ) => {
    const channel = 'agent:stream-output';
    const wrapped = (_: Electron.IpcRendererEvent, data: any) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onAgentStreamError: (
    listener: (data: { providerId: 'codex' | 'claude'; workspaceId: string; error: string }) => void
  ) => {
    const channel = 'agent:stream-error';
    const wrapped = (_: Electron.IpcRendererEvent, data: any) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onAgentStreamComplete: (
    listener: (data: {
      providerId: 'codex' | 'claude';
      workspaceId: string;
      exitCode: number;
    }) => void
  ) => {
    const channel = 'agent:stream-complete';
    const wrapped = (_: Electron.IpcRendererEvent, data: any) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
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

  // PTY management
  ptyStart: (opts: {
    id: string;
    cwd?: string;
    shell?: string;
    env?: Record<string, string>;
    cols?: number;
    rows?: number;
  }) => Promise<{ ok: boolean }>;
  ptyInput: (args: { id: string; data: string }) => void;
  ptyResize: (args: { id: string; cols: number; rows: number }) => void;
  ptyKill: (id: string) => void;
  onPtyData: (id: string, listener: (data: string) => void) => () => void;
  onPtyHistory: (id: string, listener: (data: string) => void) => () => void;
  onPtyExit: (
    id: string,
    listener: (info: { exitCode: number; signal?: number }) => void
  ) => () => void;
  // Worktree management
  worktreeCreate: (args: {
    projectPath: string;
    workspaceName: string;
    projectId: string;
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

  // Codex integration
  codexCheckInstallation: () => Promise<{
    success: boolean;
    isInstalled?: boolean;
    error?: string;
  }>;
  codexCreateAgent: (
    workspaceId: string,
    worktreePath: string
  ) => Promise<{ success: boolean; agent?: any; error?: string }>;
  codexSendMessage: (
    workspaceId: string,
    message: string
  ) => Promise<{ success: boolean; response?: any; error?: string }>;
  codexSendMessageStream: (
    workspaceId: string,
    message: string,
    conversationId?: string
  ) => Promise<{ success: boolean; error?: string }>;
  codexStopStream: (
    workspaceId: string
  ) => Promise<{ success: boolean; stopped?: boolean; error?: string }>;
  codexGetStreamTail: (
    workspaceId: string
  ) => Promise<{ success: boolean; tail?: string; startedAt?: string; error?: string }>;
  codexGetAgentStatus: (
    workspaceId: string
  ) => Promise<{ success: boolean; agent?: any; error?: string }>;
  codexGetAllAgents: () => Promise<{ success: boolean; agents?: any[]; error?: string }>;
  codexRemoveAgent: (
    workspaceId: string
  ) => Promise<{ success: boolean; removed?: boolean; error?: string }>;
  codexGetInstallationInstructions: () => Promise<{
    success: boolean;
    instructions?: string;
    error?: string;
  }>;

  // Streaming event listeners
  onCodexStreamOutput: (
    listener: (data: {
      workspaceId: string;
      output: string;
      agentId: string;
      conversationId?: string;
    }) => void
  ) => () => void;
  onCodexStreamError: (
    listener: (data: {
      workspaceId: string;
      error: string;
      agentId: string;
      conversationId?: string;
    }) => void
  ) => () => void;
  onCodexStreamComplete: (
    listener: (data: {
      workspaceId: string;
      exitCode: number;
      agentId: string;
      conversationId?: string;
    }) => void
  ) => () => void;

  // Generic agent integration
  agentCheckInstallation: (
    providerId: 'codex' | 'claude'
  ) => Promise<{ success: boolean; isInstalled?: boolean; error?: string }>;
  agentGetInstallationInstructions: (
    providerId: 'codex' | 'claude'
  ) => Promise<{ success: boolean; instructions?: string; error?: string }>;
  agentSendMessageStream: (args: {
    providerId: 'codex' | 'claude';
    workspaceId: string;
    worktreePath: string;
    message: string;
    conversationId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  agentStopStream: (args: {
    providerId: 'codex' | 'claude';
    workspaceId: string;
  }) => Promise<{ success: boolean; error?: string }>;
  onAgentStreamOutput: (
    listener: (data: {
      providerId: 'codex' | 'claude';
      workspaceId: string;
      output?: string;
      agentId?: string;
      conversationId?: string;
    }) => void
  ) => () => void;
  onAgentStreamError: (
    listener: (data: { providerId: 'codex' | 'claude'; workspaceId: string; error: string }) => void
  ) => () => void;
  onAgentStreamComplete: (
    listener: (data: {
      providerId: 'codex' | 'claude';
      workspaceId: string;
      exitCode: number;
    }) => void
  ) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
