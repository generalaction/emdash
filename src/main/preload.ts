import { contextBridge, ipcRenderer } from 'electron';
import type { TerminalSnapshotPayload } from './types/terminalSnapshot';
import type { OpenInAppId } from '../shared/openInApps';
import type { AgentEvent } from '../shared/agentEvents';

// Keep preload self-contained: sandboxed preload cannot reliably require local runtime modules.
const LIFECYCLE_EVENT_CHANNEL = 'lifecycle:event';
const GIT_STATUS_CHANGED_CHANNEL = 'git:status-changed';

const gitStatusChangedListeners = new Set<(data: { taskPath: string; error?: string }) => void>();
let gitStatusBridgeAttached = false;

function attachGitStatusBridgeOnce() {
  if (gitStatusBridgeAttached) return;
  gitStatusBridgeAttached = true;
  ipcRenderer.on(
    GIT_STATUS_CHANGED_CHANNEL,
    (_: Electron.IpcRendererEvent, data: { taskPath: string; error?: string }) => {
      for (const listener of gitStatusChangedListeners) {
        try {
          listener(data);
        } catch {}
      }
    }
  );
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('app:getAppVersion'),
  getElectronVersion: () => ipcRenderer.invoke('app:getElectronVersion'),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  listInstalledFonts: (args?: { refresh?: boolean }) =>
    ipcRenderer.invoke('app:listInstalledFonts', args),
  undo: () => ipcRenderer.invoke('app:undo'),
  redo: () => ipcRenderer.invoke('app:redo'),
  // Updater
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('update:quit-and-install'),
  openLatestDownload: () => ipcRenderer.invoke('update:open-latest'),
  // Enhanced update methods
  getUpdateState: () => ipcRenderer.invoke('update:get-state'),
  getUpdateSettings: () => ipcRenderer.invoke('update:get-settings'),
  updateUpdateSettings: (settings: any) => ipcRenderer.invoke('update:update-settings', settings),
  getReleaseNotes: () => ipcRenderer.invoke('update:get-release-notes'),
  checkForUpdatesNow: () => ipcRenderer.invoke('update:check-now'),
  onUpdateEvent: (listener: (data: { type: string; payload?: any }) => void) => {
    const pairs: Array<[string, string]> = [
      ['update:checking', 'checking'],
      ['update:available', 'available'],
      ['update:not-available', 'not-available'],
      ['update:error', 'error'],
      ['update:downloading', 'downloading'],
      ['update:download-progress', 'download-progress'],
      ['update:downloaded', 'downloaded'],
      ['update:installing', 'installing'],
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
  openIn: (args: { app: OpenInAppId; path: string }) => ipcRenderer.invoke('app:openIn', args),

  // Check which apps are installed
  checkInstalledApps: () =>
    ipcRenderer.invoke('app:checkInstalledApps') as Promise<Record<OpenInAppId, boolean>>,

  // PTY management
  ptyStart: (opts: {
    id: string;
    cwd?: string;
    remote?: { connectionId: string };
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

  // Direct PTY spawn (no shell wrapper, bypasses shell config loading)
  ptyStartDirect: (opts: {
    id: string;
    providerId: string;
    cwd: string;
    remote?: { connectionId: string };
    cols?: number;
    rows?: number;
    autoApprove?: boolean;
    initialPrompt?: string;
    clickTime?: number;
    env?: Record<string, string>;
    resume?: boolean;
  }) => ipcRenderer.invoke('pty:startDirect', opts),

  ptyScpToRemote: (args: { connectionId: string; localPaths: string[] }) =>
    ipcRenderer.invoke('pty:scp-to-remote', args),

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
  onAgentEvent: (listener: (event: AgentEvent, meta: { appFocused: boolean }) => void) => {
    const channel = 'agent:event';
    const wrapped = (
      _: Electron.IpcRendererEvent,
      data: AgentEvent,
      meta: { appFocused: boolean }
    ) => listener(data, meta);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  terminalGetTheme: () => ipcRenderer.invoke('terminal:getTheme'),

  // App settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: any) => ipcRenderer.invoke('settings:update', settings),

  // Menu events (main → renderer)
  onMenuOpenSettings: (listener: () => void) => {
    const channel = 'menu:open-settings';
    const wrapped = () => listener();
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onMenuCheckForUpdates: (listener: () => void) => {
    const channel = 'menu:check-for-updates';
    const wrapped = () => listener();
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onMenuUndo: (listener: () => void) => {
    const channel = 'menu:undo';
    const wrapped = () => listener();
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onMenuRedo: (listener: () => void) => {
    const channel = 'menu:redo';
    const wrapped = () => listener();
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  // Worktree management
  worktreeCreate: (args: {
    projectPath: string;
    taskName: string;
    projectId: string;
    baseRef?: string;
  }) => ipcRenderer.invoke('worktree:create', args),
  worktreeList: (args: { projectPath: string }) => ipcRenderer.invoke('worktree:list', args),
  worktreeRemove: (args: {
    projectPath: string;
    worktreeId: string;
    worktreePath?: string;
    branch?: string;
    taskName?: string;
  }) => ipcRenderer.invoke('worktree:remove', args),
  worktreeStatus: (args: { worktreePath: string }) => ipcRenderer.invoke('worktree:status', args),
  worktreeMerge: (args: { projectPath: string; worktreeId: string }) =>
    ipcRenderer.invoke('worktree:merge', args),
  worktreeGet: (args: { worktreeId: string }) => ipcRenderer.invoke('worktree:get', args),
  worktreeGetAll: () => ipcRenderer.invoke('worktree:getAll'),

  // Worktree pool (reserve) management for instant task creation
  worktreeEnsureReserve: (args: { projectId: string; projectPath: string; baseRef?: string }) =>
    ipcRenderer.invoke('worktree:ensureReserve', args),
  worktreeHasReserve: (args: { projectId: string }) =>
    ipcRenderer.invoke('worktree:hasReserve', args),
  worktreeClaimReserve: (args: {
    projectId: string;
    projectPath: string;
    taskName: string;
    baseRef?: string;
  }) => ipcRenderer.invoke('worktree:claimReserve', args),
  worktreeClaimReserveAndSaveTask: (args: {
    projectId: string;
    projectPath: string;
    taskName: string;
    baseRef?: string;
    task: {
      projectId: string;
      name: string;
      status: 'active' | 'idle' | 'running';
      agentId?: string | null;
      metadata?: any;
      useWorktree?: boolean;
    };
  }) => ipcRenderer.invoke('worktree:claimReserveAndSaveTask', args),
  worktreeRemoveReserve: (args: { projectId: string; projectPath?: string; isRemote?: boolean }) =>
    ipcRenderer.invoke('worktree:removeReserve', args),

  // Lifecycle scripts
  lifecycleGetScript: (args: { projectPath: string; phase: 'setup' | 'run' | 'teardown' }) =>
    ipcRenderer.invoke('lifecycle:getScript', args),
  lifecycleSetup: (args: { taskId: string; taskPath: string; projectPath: string }) =>
    ipcRenderer.invoke('lifecycle:setup', args),
  lifecycleRunStart: (args: { taskId: string; taskPath: string; projectPath: string }) =>
    ipcRenderer.invoke('lifecycle:run:start', args),
  lifecycleRunStop: (args: { taskId: string }) => ipcRenderer.invoke('lifecycle:run:stop', args),
  lifecycleTeardown: (args: { taskId: string; taskPath: string; projectPath: string }) =>
    ipcRenderer.invoke('lifecycle:teardown', args),
  lifecycleGetState: (args: { taskId: string }) => ipcRenderer.invoke('lifecycle:getState', args),
  lifecycleClearTask: (args: { taskId: string }) => ipcRenderer.invoke('lifecycle:clearTask', args),
  onLifecycleEvent: (listener: (data: any) => void) => {
    const wrapped = (_: Electron.IpcRendererEvent, data: any) => listener(data);
    ipcRenderer.on(LIFECYCLE_EVENT_CHANNEL, wrapped);
    return () => ipcRenderer.removeListener(LIFECYCLE_EVENT_CHANNEL, wrapped);
  },

  // Filesystem helpers
  fsList: (
    root: string,
    opts?: {
      includeDirs?: boolean;
      maxEntries?: number;
      timeBudgetMs?: number;
      connectionId?: string;
      remotePath?: string;
      recursive?: boolean;
    }
  ) => ipcRenderer.invoke('fs:list', { root, ...(opts || {}) }),
  fsRead: (
    root: string,
    relPath: string,
    maxBytes?: number,
    remote?: { connectionId: string; remotePath: string }
  ) => ipcRenderer.invoke('fs:read', { root, relPath, maxBytes, ...remote }),
  fsReadImage: (
    root: string,
    relPath: string,
    remote?: { connectionId: string; remotePath: string }
  ) => ipcRenderer.invoke('fs:read-image', { root, relPath, ...remote }),
  fsSearchContent: (
    root: string,
    query: string,
    options?: {
      caseSensitive?: boolean;
      maxResults?: number;
      fileExtensions?: string[];
    },
    remote?: { connectionId: string; remotePath: string }
  ) => ipcRenderer.invoke('fs:searchContent', { root, query, options, ...remote }),
  fsWriteFile: (
    root: string,
    relPath: string,
    content: string,
    mkdirs?: boolean,
    remote?: { connectionId: string; remotePath: string }
  ) => ipcRenderer.invoke('fs:write', { root, relPath, content, mkdirs, ...remote }),
  fsRemove: (
    root: string,
    relPath: string,
    remote?: { connectionId: string; remotePath: string }
  ) => ipcRenderer.invoke('fs:remove', { root, relPath, ...remote }),
  getProjectConfig: (projectPath: string) =>
    ipcRenderer.invoke('fs:getProjectConfig', { projectPath }),
  saveProjectConfig: (projectPath: string, content: string) =>
    ipcRenderer.invoke('fs:saveProjectConfig', { projectPath, content }),
  // Attachments
  saveAttachment: (args: { taskPath: string; srcPath: string; subdir?: string }) =>
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
  getGitStatus: (taskPath: string) => ipcRenderer.invoke('git:get-status', taskPath),
  watchGitStatus: (taskPath: string) => ipcRenderer.invoke('git:watch-status', taskPath),
  unwatchGitStatus: (taskPath: string, watchId?: string) =>
    ipcRenderer.invoke('git:unwatch-status', taskPath, watchId),
  onGitStatusChanged: (listener: (data: { taskPath: string; error?: string }) => void) => {
    attachGitStatusBridgeOnce();
    gitStatusChangedListeners.add(listener);
    return () => {
      gitStatusChangedListeners.delete(listener);
    };
  },
  getFileDiff: (args: { taskPath: string; filePath: string }) =>
    ipcRenderer.invoke('git:get-file-diff', args),
  stageFile: (args: { taskPath: string; filePath: string }) =>
    ipcRenderer.invoke('git:stage-file', args),
  stageAllFiles: (args: { taskPath: string }) => ipcRenderer.invoke('git:stage-all-files', args),
  unstageFile: (args: { taskPath: string; filePath: string }) =>
    ipcRenderer.invoke('git:unstage-file', args),
  revertFile: (args: { taskPath: string; filePath: string }) =>
    ipcRenderer.invoke('git:revert-file', args),
  gitCommitAndPush: (args: {
    taskPath: string;
    commitMessage?: string;
    createBranchIfOnDefault?: boolean;
    branchPrefix?: string;
  }) => ipcRenderer.invoke('git:commit-and-push', args),
  generatePrContent: (args: { taskPath: string; base?: string }) =>
    ipcRenderer.invoke('git:generate-pr-content', args),
  createPullRequest: (args: {
    taskPath: string;
    title?: string;
    body?: string;
    base?: string;
    head?: string;
    draft?: boolean;
    web?: boolean;
    fill?: boolean;
  }) => ipcRenderer.invoke('git:create-pr', args),
  mergeToMain: (args: { taskPath: string }) => ipcRenderer.invoke('git:merge-to-main', args),
  mergePr: (args: {
    taskPath: string;
    prNumber?: number;
    strategy?: 'merge' | 'squash' | 'rebase';
    admin?: boolean;
  }) => ipcRenderer.invoke('git:merge-pr', args),
  getPrStatus: (args: { taskPath: string }) => ipcRenderer.invoke('git:get-pr-status', args),
  getCheckRuns: (args: { taskPath: string }) => ipcRenderer.invoke('git:get-check-runs', args),
  getPrComments: (args: { taskPath: string; prNumber?: number }) =>
    ipcRenderer.invoke('git:get-pr-comments', args),
  getBranchStatus: (args: { taskPath: string }) =>
    ipcRenderer.invoke('git:get-branch-status', args),
  renameBranch: (args: { repoPath: string; oldBranch: string; newBranch: string }) =>
    ipcRenderer.invoke('git:rename-branch', args),
  listRemoteBranches: (args: { projectPath: string; remote?: string }) =>
    ipcRenderer.invoke('git:list-remote-branches', args),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  clipboardWriteText: (text: string) => ipcRenderer.invoke('app:clipboard-write-text', text),
  paste: () => ipcRenderer.invoke('app:paste'),
  // Telemetry (minimal, anonymous)
  captureTelemetry: (event: string, properties?: Record<string, any>) =>
    ipcRenderer.invoke('telemetry:capture', { event, properties }),
  getTelemetryStatus: () => ipcRenderer.invoke('telemetry:get-status'),
  setTelemetryEnabled: (enabled: boolean) => ipcRenderer.invoke('telemetry:set-enabled', enabled),
  setOnboardingSeen: (flag: boolean) => ipcRenderer.invoke('telemetry:set-onboarding-seen', flag),
  connectToGitHub: (projectPath: string) => ipcRenderer.invoke('github:connect', projectPath),

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
  githubGetOwners: () => ipcRenderer.invoke('github:getOwners'),
  githubValidateRepoName: (name: string, owner: string) =>
    ipcRenderer.invoke('github:validateRepoName', name, owner),
  githubCreateNewProject: (params: {
    name: string;
    description?: string;
    owner: string;
    isPrivate: boolean;
    gitignoreTemplate?: string;
  }) => ipcRenderer.invoke('github:createNewProject', params),
  githubListPullRequests: (projectPath: string) =>
    ipcRenderer.invoke('github:listPullRequests', { projectPath }),
  githubCreatePullRequestWorktree: (args: {
    projectPath: string;
    projectId: string;
    prNumber: number;
    prTitle?: string;
    taskName?: string;
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
  getProviderCustomConfig: (providerId: string) =>
    ipcRenderer.invoke('providers:getCustomConfig', providerId),
  getAllProviderCustomConfigs: () => ipcRenderer.invoke('providers:getAllCustomConfigs'),
  updateProviderCustomConfig: (providerId: string, config: any) =>
    ipcRenderer.invoke('providers:updateCustomConfig', providerId, config),
  // Database methods
  getProjects: () => ipcRenderer.invoke('db:getProjects'),
  saveProject: (project: any) => ipcRenderer.invoke('db:saveProject', project),
  getTasks: (projectId?: string) => ipcRenderer.invoke('db:getTasks', projectId),
  saveTask: (task: any) => ipcRenderer.invoke('db:saveTask', task),
  deleteProject: (projectId: string) => ipcRenderer.invoke('db:deleteProject', projectId),
  deleteTask: (taskId: string) => ipcRenderer.invoke('db:deleteTask', taskId),
  archiveTask: (taskId: string) => ipcRenderer.invoke('db:archiveTask', taskId),
  restoreTask: (taskId: string) => ipcRenderer.invoke('db:restoreTask', taskId),
  getArchivedTasks: (projectId?: string) => ipcRenderer.invoke('db:getArchivedTasks', projectId),

  // Conversation management
  saveConversation: (conversation: any) => ipcRenderer.invoke('db:saveConversation', conversation),
  getConversations: (taskId: string) => ipcRenderer.invoke('db:getConversations', taskId),
  getOrCreateDefaultConversation: (taskId: string) =>
    ipcRenderer.invoke('db:getOrCreateDefaultConversation', taskId),
  saveMessage: (message: any) => ipcRenderer.invoke('db:saveMessage', message),
  getMessages: (conversationId: string) => ipcRenderer.invoke('db:getMessages', conversationId),
  deleteConversation: (conversationId: string) =>
    ipcRenderer.invoke('db:deleteConversation', conversationId),
  cleanupSessionDirectory: (args: { taskPath: string; conversationId: string }) =>
    ipcRenderer.invoke('db:cleanupSessionDirectory', args),

  // Multi-chat support
  createConversation: (params: { taskId: string; title: string; provider?: string }) =>
    ipcRenderer.invoke('db:createConversation', params),
  setActiveConversation: (params: { taskId: string; conversationId: string }) =>
    ipcRenderer.invoke('db:setActiveConversation', params),
  getActiveConversation: (taskId: string) => ipcRenderer.invoke('db:getActiveConversation', taskId),
  reorderConversations: (params: { taskId: string; conversationIds: string[] }) =>
    ipcRenderer.invoke('db:reorderConversations', params),
  updateConversationTitle: (params: { conversationId: string; title: string }) =>
    ipcRenderer.invoke('db:updateConversationTitle', params),

  // Line comments management
  lineCommentsCreate: (input: any) => ipcRenderer.invoke('lineComments:create', input),
  lineCommentsGet: (args: { taskId: string; filePath?: string }) =>
    ipcRenderer.invoke('lineComments:get', args),
  lineCommentsUpdate: (input: { id: string; content: string }) =>
    ipcRenderer.invoke('lineComments:update', input),
  lineCommentsDelete: (id: string) => ipcRenderer.invoke('lineComments:delete', id),
  lineCommentsGetFormatted: (taskId: string) =>
    ipcRenderer.invoke('lineComments:getFormatted', taskId),
  lineCommentsMarkSent: (commentIds: string[]) =>
    ipcRenderer.invoke('lineComments:markSent', commentIds),
  lineCommentsGetUnsent: (taskId: string) => ipcRenderer.invoke('lineComments:getUnsent', taskId),

  // Debug helpers
  debugAppendLog: (filePath: string, content: string, options?: { reset?: boolean }) =>
    ipcRenderer.invoke('debug:append-log', filePath, content, options ?? {}),

  // PlanMode strict lock
  planApplyLock: (taskPath: string) => ipcRenderer.invoke('plan:lock', taskPath),
  planReleaseLock: (taskPath: string) => ipcRenderer.invoke('plan:unlock', taskPath),
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
    taskId: string;
    taskPath: string;
    script?: string;
    parentProjectPath?: string;
  }) => ipcRenderer.invoke('preview:host:start', args),
  hostPreviewSetup: (args: { taskId: string; taskPath: string }) =>
    ipcRenderer.invoke('preview:host:setup', args),
  hostPreviewStop: (taskId: string) => ipcRenderer.invoke('preview:host:stop', taskId),
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

  // SSH operations (unwrap { success, ... } IPC responses)
  sshTestConnection: (config: any) => ipcRenderer.invoke('ssh:testConnection', config),
  sshSaveConnection: async (config: any) => {
    const res = await ipcRenderer.invoke('ssh:saveConnection', config);
    if (res && typeof res === 'object' && 'success' in res && !res.success) {
      throw new Error((res as any).error || 'Failed to save SSH connection');
    }
    return (res as any).connection;
  },
  sshGetConnections: async () => {
    const res = await ipcRenderer.invoke('ssh:getConnections');
    if (res && typeof res === 'object' && 'success' in res && !res.success) {
      throw new Error((res as any).error || 'Failed to load SSH connections');
    }
    return (res as any).connections || [];
  },
  sshDeleteConnection: async (id: string) => {
    const res = await ipcRenderer.invoke('ssh:deleteConnection', id);
    if (res && typeof res === 'object' && 'success' in res && !res.success) {
      throw new Error((res as any).error || 'Failed to delete SSH connection');
    }
  },
  sshConnect: async (arg: any) => {
    const res = await ipcRenderer.invoke('ssh:connect', arg);
    if (res && typeof res === 'object' && 'success' in res) {
      if (!res.success) {
        throw new Error((res as any).error || 'SSH connect failed');
      }
      return (res as any).connectionId as string;
    }
    return res as string;
  },
  sshDisconnect: async (connectionId: string) => {
    const res = await ipcRenderer.invoke('ssh:disconnect', connectionId);
    if (res && typeof res === 'object' && 'success' in res && !res.success) {
      throw new Error((res as any).error || 'SSH disconnect failed');
    }
  },
  sshExecuteCommand: async (connectionId: string, command: string, cwd?: string) => {
    const res = await ipcRenderer.invoke('ssh:executeCommand', connectionId, command, cwd);
    if (res && typeof res === 'object' && 'success' in res && !res.success) {
      throw new Error((res as any).error || 'SSH command failed');
    }
    return {
      stdout: (res as any).stdout || '',
      stderr: (res as any).stderr || '',
      exitCode: (res as any).exitCode ?? -1,
    };
  },
  sshListFiles: async (connectionId: string, path: string) => {
    const res = await ipcRenderer.invoke('ssh:listFiles', connectionId, path);
    if (res && typeof res === 'object' && 'success' in res && !res.success) {
      throw new Error((res as any).error || 'SSH list files failed');
    }
    return (res as any).files || [];
  },
  sshReadFile: async (connectionId: string, path: string) => {
    const res = await ipcRenderer.invoke('ssh:readFile', connectionId, path);
    if (res && typeof res === 'object' && 'success' in res && !res.success) {
      throw new Error((res as any).error || 'SSH read file failed');
    }
    return (res as any).content || '';
  },
  sshWriteFile: async (connectionId: string, path: string, content: string) => {
    const res = await ipcRenderer.invoke('ssh:writeFile', connectionId, path, content);
    if (res && typeof res === 'object' && 'success' in res && !res.success) {
      throw new Error((res as any).error || 'SSH write file failed');
    }
  },
  sshGetState: async (connectionId: string) => {
    const res = await ipcRenderer.invoke('ssh:getState', connectionId);
    if (res && typeof res === 'object' && 'success' in res && !res.success) {
      throw new Error((res as any).error || 'SSH get state failed');
    }
    return (res as any).state;
  },
  sshGetConfig: () => ipcRenderer.invoke('ssh:getSshConfig'),
  sshGetSshConfigHost: (hostAlias: string) => ipcRenderer.invoke('ssh:getSshConfigHost', hostAlias),
  sshCheckIsGitRepo: async (connectionId: string, remotePath: string) => {
    const res = await ipcRenderer.invoke('ssh:checkIsGitRepo', connectionId, remotePath);
    if (res && typeof res === 'object' && 'success' in res && !res.success) {
      throw new Error((res as any).error || 'SSH check git repo failed');
    }
    return (res as any).isGitRepo as boolean;
  },
  sshInitRepo: async (connectionId: string, parentPath: string, repoName: string) => {
    const res = await ipcRenderer.invoke('ssh:initRepo', connectionId, parentPath, repoName);
    if (res && typeof res === 'object' && 'success' in res && !res.success) {
      throw new Error((res as any).error || 'SSH init repo failed');
    }
    return (res as any).path as string;
  },
  sshCloneRepo: async (connectionId: string, repoUrl: string, targetPath: string) => {
    const res = await ipcRenderer.invoke('ssh:cloneRepo', connectionId, repoUrl, targetPath);
    if (res && typeof res === 'object' && 'success' in res && !res.success) {
      throw new Error((res as any).error || 'SSH clone repo failed');
    }
    return (res as any).path as string;
  },

  // Skills management
  skillsGetCatalog: () => ipcRenderer.invoke('skills:getCatalog'),
  skillsRefreshCatalog: () => ipcRenderer.invoke('skills:refreshCatalog'),
  skillsInstall: (args: { skillId: string }) => ipcRenderer.invoke('skills:install', args),
  skillsUninstall: (args: { skillId: string }) => ipcRenderer.invoke('skills:uninstall', args),
  skillsGetDetail: (args: { skillId: string }) => ipcRenderer.invoke('skills:getDetail', args),
  skillsGetDetectedAgents: () => ipcRenderer.invoke('skills:getDetectedAgents'),
  skillsCreate: (args: { name: string; description: string }) =>
    ipcRenderer.invoke('skills:create', args),
});

// Type definitions for the exposed API
export interface ElectronAPI {
  // App info
  getVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  clipboardWriteText: (text: string) => Promise<{ success: boolean; error?: string }>;
  paste: () => Promise<{ success: boolean; error?: string }>;
  listInstalledFonts: (args?: {
    refresh?: boolean;
  }) => Promise<{ success: boolean; fonts?: string[]; cached?: boolean; error?: string }>;
  // Updater
  checkForUpdates: () => Promise<{ success: boolean; result?: any; error?: string }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  quitAndInstallUpdate: () => Promise<{ success: boolean; error?: string }>;
  openLatestDownload: () => Promise<{ success: boolean; error?: string }>;
  onUpdateEvent: (listener: (data: { type: string; payload?: any }) => void) => () => void;

  // Telemetry (minimal, anonymous)
  captureTelemetry: (
    event: string,
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
    initialPrompt?: string;
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
    taskName: string;
    projectId: string;
    baseRef?: string;
  }) => Promise<{ success: boolean; worktree?: any; error?: string }>;
  worktreeList: (args: {
    projectPath: string;
  }) => Promise<{ success: boolean; worktrees?: any[]; error?: string }>;
  worktreeRemove: (args: {
    projectPath: string;
    worktreeId: string;
    worktreePath?: string;
    branch?: string;
    taskName?: string;
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
  // Worktree pool (reserve) management for instant task creation
  worktreeEnsureReserve: (args: {
    projectId: string;
    projectPath: string;
    baseRef?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  worktreeHasReserve: (args: {
    projectId: string;
  }) => Promise<{ success: boolean; hasReserve?: boolean; error?: string }>;
  worktreeClaimReserve: (args: {
    projectId: string;
    projectPath: string;
    taskName: string;
    baseRef?: string;
  }) => Promise<{
    success: boolean;
    worktree?: any;
    needsBaseRefSwitch?: boolean;
    error?: string;
  }>;
  worktreeClaimReserveAndSaveTask: (args: {
    projectId: string;
    projectPath: string;
    taskName: string;
    baseRef?: string;
    task: {
      projectId: string;
      name: string;
      status: 'active' | 'idle' | 'running';
      agentId?: string | null;
      metadata?: any;
      useWorktree?: boolean;
    };
  }) => Promise<{
    success: boolean;
    worktree?: any;
    task?: any;
    needsBaseRefSwitch?: boolean;
    error?: string;
  }>;
  worktreeRemoveReserve: (args: {
    projectId: string;
  }) => Promise<{ success: boolean; error?: string }>;

  // Lifecycle scripts
  lifecycleGetScript: (args: {
    projectPath: string;
    phase: 'setup' | 'run' | 'teardown';
  }) => Promise<{ success: boolean; script?: string | null; error?: string }>;
  lifecycleSetup: (args: {
    taskId: string;
    taskPath: string;
    projectPath: string;
  }) => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
  lifecycleRunStart: (args: {
    taskId: string;
    taskPath: string;
    projectPath: string;
  }) => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
  lifecycleRunStop: (args: {
    taskId: string;
  }) => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
  lifecycleTeardown: (args: {
    taskId: string;
    taskPath: string;
    projectPath: string;
  }) => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
  lifecycleGetState: (args: { taskId: string }) => Promise<{
    success: boolean;
    state?: {
      taskId: string;
      setup: {
        status: 'idle' | 'running' | 'succeeded' | 'failed';
        startedAt?: string;
        finishedAt?: string;
        exitCode?: number | null;
        error?: string | null;
      };
      run: {
        status: 'idle' | 'running' | 'succeeded' | 'failed';
        startedAt?: string;
        finishedAt?: string;
        exitCode?: number | null;
        error?: string | null;
        pid?: number | null;
      };
      teardown: {
        status: 'idle' | 'running' | 'succeeded' | 'failed';
        startedAt?: string;
        finishedAt?: string;
        exitCode?: number | null;
        error?: string | null;
      };
    };
    error?: string;
  }>;
  lifecycleClearTask: (args: { taskId: string }) => Promise<{ success: boolean; error?: string }>;
  onLifecycleEvent: (listener: (data: any) => void) => () => void;

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
  getGitStatus: (taskPath: string) => Promise<{
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
  watchGitStatus: (taskPath: string) => Promise<{
    success: boolean;
    watchId?: string;
    error?: string;
  }>;
  unwatchGitStatus: (
    taskPath: string,
    watchId?: string
  ) => Promise<{
    success: boolean;
    error?: string;
  }>;
  onGitStatusChanged: (
    listener: (data: { taskPath: string; error?: string }) => void
  ) => () => void;
  getFileDiff: (args: { taskPath: string; filePath: string }) => Promise<{
    success: boolean;
    diff?: { lines: Array<{ left?: string; right?: string; type: 'context' | 'add' | 'del' }> };
    error?: string;
  }>;
  gitCommitAndPush: (args: {
    taskPath: string;
    commitMessage?: string;
    createBranchIfOnDefault?: boolean;
    branchPrefix?: string;
  }) => Promise<{ success: boolean; branch?: string; output?: string; error?: string }>;
  createPullRequest: (args: {
    taskPath: string;
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
    opts?: {
      includeDirs?: boolean;
      maxEntries?: number;
      timeBudgetMs?: number;
      connectionId?: string;
      remotePath?: string;
    }
  ) => Promise<{
    success: boolean;
    items?: Array<{ path: string; type: 'file' | 'dir' }>;
    error?: string;
    canceled?: boolean;
    truncated?: boolean;
    reason?: string;
    durationMs?: number;
  }>;
  fsRead: (
    root: string,
    relPath: string,
    maxBytes?: number,
    remote?: { connectionId: string; remotePath: string }
  ) => Promise<{
    success: boolean;
    path?: string;
    size?: number;
    truncated?: boolean;
    content?: string;
    error?: string;
  }>;

  // GitHub integration
  githubAuth: () => Promise<{
    success: boolean;
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
  }>;
  githubCancelAuth: () => Promise<{ success: boolean; error?: string }>;

  // GitHub auth event listeners (return cleanup function)
  onGithubAuthDeviceCode: (
    callback: (data: {
      userCode: string;
      verificationUri: string;
      expiresIn: number;
      interval: number;
    }) => void
  ) => () => void;
  onGithubAuthPolling: (callback: (data: { status: string }) => void) => () => void;
  onGithubAuthSlowDown: (callback: (data: { newInterval: number }) => void) => () => void;
  onGithubAuthSuccess: (callback: (data: { token: string; user: any }) => void) => () => void;
  onGithubAuthError: (callback: (data: { error: string; message: string }) => void) => () => void;
  onGithubAuthCancelled: (callback: () => void) => () => void;
  onGithubAuthUserUpdated: (callback: (data: { user: any }) => void) => () => void;

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
    taskName?: string;
    branchName?: string;
  }) => Promise<{
    success: boolean;
    worktree?: any;
    branchName?: string;
    taskName?: string;
    error?: string;
  }>;
  githubLogout: () => Promise<void>;
  githubCheckCLIInstalled: () => Promise<boolean>;
  githubInstallCLI: () => Promise<{ success: boolean; error?: string }>;

  // Database methods
  getProjects: () => Promise<any[]>;
  saveProject: (project: any) => Promise<{ success: boolean; error?: string }>;
  getTasks: (projectId?: string) => Promise<any[]>;
  saveTask: (task: any) => Promise<{ success: boolean; error?: string }>;
  deleteProject: (projectId: string) => Promise<{ success: boolean; error?: string }>;
  deleteTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;

  // Conversation management
  saveConversation: (conversation: any) => Promise<{ success: boolean; error?: string }>;
  getConversations: (
    taskId: string
  ) => Promise<{ success: boolean; conversations?: any[]; error?: string }>;
  getOrCreateDefaultConversation: (
    taskId: string
  ) => Promise<{ success: boolean; conversation?: any; error?: string }>;
  saveMessage: (message: any) => Promise<{ success: boolean; error?: string }>;
  getMessages: (
    conversationId: string
  ) => Promise<{ success: boolean; messages?: any[]; error?: string }>;
  deleteConversation: (conversationId: string) => Promise<{ success: boolean; error?: string }>;
  cleanupSessionDirectory: (args: {
    taskPath: string;
    conversationId: string;
  }) => Promise<{ success: boolean }>;

  // Multi-chat support
  createConversation: (params: {
    taskId: string;
    title: string;
    provider?: string;
  }) => Promise<{ success: boolean; conversation?: any; error?: string }>;
  setActiveConversation: (params: {
    taskId: string;
    conversationId: string;
  }) => Promise<{ success: boolean; error?: string }>;
  getActiveConversation: (
    taskId: string
  ) => Promise<{ success: boolean; conversation?: any; error?: string }>;
  reorderConversations: (params: {
    taskId: string;
    conversationIds: string[];
  }) => Promise<{ success: boolean; error?: string }>;
  updateConversationTitle: (params: {
    conversationId: string;
    title: string;
  }) => Promise<{ success: boolean; error?: string }>;

  // Host preview (non-container)
  hostPreviewStart: (args: {
    taskId: string;
    taskPath: string;
    script?: string;
    parentProjectPath?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  hostPreviewSetup: (args: {
    taskId: string;
    taskPath: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  hostPreviewStop: (taskId: string) => Promise<{ ok: boolean }>;
  onHostPreviewEvent: (
    listener: (data: { type: 'url'; taskId: string; url: string }) => void
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

  // SSH operations
  sshTestConnection: (
    config: any
  ) => Promise<{ success: boolean; latency?: number; error?: string }>;
  sshSaveConnection: (config: any) => Promise<any>;
  sshGetConnections: () => Promise<any[]>;
  sshDeleteConnection: (id: string) => Promise<void>;
  sshConnect: (arg: any) => Promise<string>;
  sshDisconnect: (connectionId: string) => Promise<void>;
  sshExecuteCommand: (
    connectionId: string,
    command: string,
    cwd?: string
  ) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
  sshListFiles: (connectionId: string, path: string) => Promise<any[]>;
  sshReadFile: (connectionId: string, path: string) => Promise<string>;
  sshWriteFile: (connectionId: string, path: string, content: string) => Promise<void>;
  sshGetState: (connectionId: string) => Promise<any>;
  sshGetConfig: () => Promise<{ success: boolean; hosts?: any[]; error?: string }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
