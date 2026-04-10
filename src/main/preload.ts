import { contextBridge, ipcRenderer } from 'electron';
import type { TerminalSnapshotPayload } from './types/terminalSnapshot';
import type { OpenInAppId } from '../shared/openInApps';
import type { AgentEvent } from '../shared/agentEvents';
import type { McpServer } from '../shared/mcp/types';
import type { DiffPayload } from '../shared/diff/types';
import type { GitIndexUpdateArgs } from '../shared/git/types';
import type { ResourceMetricsSnapshot } from '../shared/performanceTypes';

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
  // Generic invoke for the typed RPC client (createRPCClient)
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),

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

  // Window controls (custom title bar on Windows/Linux)
  windowMinimize: () => ipcRenderer.invoke('app:windowMinimize'),
  windowMaximize: () => ipcRenderer.invoke('app:windowMaximize'),
  windowClose: () => ipcRenderer.invoke('app:windowClose'),
  windowIsMaximized: () => ipcRenderer.invoke('app:windowIsMaximized') as Promise<boolean>,
  popupMenu: (args: { label: string; x: number; y: number }) =>
    ipcRenderer.invoke('app:popupMenu', args),
  onWindowMaximizeChange: (listener: (isMaximized: boolean) => void) => {
    const onMaximize = () => listener(true);
    const onUnmaximize = () => listener(false);
    ipcRenderer.on('window:maximized', onMaximize);
    ipcRenderer.on('window:unmaximized', onUnmaximize);
    return () => {
      ipcRenderer.removeListener('window:maximized', onMaximize);
      ipcRenderer.removeListener('window:unmaximized', onUnmaximize);
    };
  },

  // Open a path in a specific app
  openIn: (args: {
    app: OpenInAppId;
    path: string;
    isRemote?: boolean;
    sshConnectionId?: string | null;
  }) => ipcRenderer.invoke('app:openIn', args),

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
  ptyKillTmux: (id: string) =>
    ipcRenderer.invoke('pty:killTmux', { id }) as Promise<{ ok: boolean; error?: string }>,

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
  ptyCleanupSessions: (args: {
    ids: string[];
    clearSnapshots?: boolean;
    waitForSnapshots?: boolean;
  }) => ipcRenderer.invoke('pty:cleanupSessions', args),
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
  onPtyActivity: (listener: (data: { id: string; chunk?: string }) => void) => {
    const channel = 'pty:activity';
    const wrapped = (_: Electron.IpcRendererEvent, data: { id: string; chunk?: string }) =>
      listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onPtyExitGlobal: (listener: (data: { id: string }) => void) => {
    const channel = 'pty:exit:global';
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
  onNotificationFocusTask: (listener: (taskId: string) => void) => {
    const channel = 'notification:focus-task';
    const wrapped = (_: Electron.IpcRendererEvent, taskId: string) => listener(taskId);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  terminalGetTheme: () => ipcRenderer.invoke('terminal:getTheme'),

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
  onMenuCloseTab: (listener: () => void) => {
    const channel = 'menu:close-tab';
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
  worktreePreflightReserve: (args: { projectId: string; projectPath: string }) =>
    ipcRenderer.invoke('worktree:preflightReserve', args),
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
  lifecycleRunStop: (args: {
    taskId: string;
    taskPath?: string;
    projectPath?: string;
    taskName?: string;
  }) => ipcRenderer.invoke('lifecycle:run:stop', args),
  lifecycleTeardown: (args: { taskId: string; taskPath: string; projectPath: string }) =>
    ipcRenderer.invoke('lifecycle:teardown', args),
  lifecycleGetState: (args: { taskId: string }) => ipcRenderer.invoke('lifecycle:getState', args),
  lifecycleGetLogs: (args: { taskId: string }) => ipcRenderer.invoke('lifecycle:getLogs', args),
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
  fsRename: (
    root: string,
    oldName: string,
    newName: string,
    remote?: { connectionId: string; remotePath: string }
  ) => ipcRenderer.invoke('fs:rename', { root, oldName, newName, ...remote }),
  fsMkdir: (root: string, relPath: string, remote?: { connectionId: string; remotePath: string }) =>
    ipcRenderer.invoke('fs:mkdir', { root, relPath, ...remote }),
  fsRmdir: (root: string, relPath: string, remote?: { connectionId: string; remotePath: string }) =>
    ipcRenderer.invoke('fs:rmdir', { root, relPath, ...remote }),
  getProjectConfig: (projectPath: string) =>
    ipcRenderer.invoke('fs:getProjectConfig', { projectPath }),
  saveProjectConfig: (projectPath: string, content: string) =>
    ipcRenderer.invoke('fs:saveProjectConfig', { projectPath, content }),
  ensureGitignore: (projectPath: string, patterns: string[]) =>
    ipcRenderer.invoke('fs:ensureGitignore', { projectPath, patterns }),
  // Attachments
  saveAttachment: (args: { taskPath: string; srcPath: string; subdir?: string }) =>
    ipcRenderer.invoke('fs:save-attachment', args),

  // Project management
  openProject: () => ipcRenderer.invoke('project:open'),
  openFile: (args?: { title?: string; message?: string; filters?: Electron.FileFilter[] }) =>
    ipcRenderer.invoke('project:openFile', args),
  getProjectSettings: (projectId: string) =>
    ipcRenderer.invoke('projectSettings:get', { projectId }),
  updateProjectSettings: (args: { projectId: string; baseRef: string }) =>
    ipcRenderer.invoke('projectSettings:update', args),
  fetchProjectBaseRef: (args: { projectId: string; projectPath: string }) =>
    ipcRenderer.invoke('projectSettings:fetchBaseRef', args),
  getGitInfo: (projectPath: string) => ipcRenderer.invoke('git:getInfo', projectPath),
  getGitStatus: (arg: string | { taskPath: string; taskId?: string }) =>
    ipcRenderer.invoke('git:get-status', arg),
  getDeleteRisks: (args: {
    targets: Array<{ id: string; taskPath: string }>;
    includePr?: boolean;
  }) => ipcRenderer.invoke('git:get-delete-risks', args),
  watchGitStatus: (arg: string | { taskPath: string; taskId?: string }) =>
    ipcRenderer.invoke('git:watch-status', arg),
  unwatchGitStatus: (arg: string | { taskPath: string; taskId?: string }, watchId?: string) =>
    ipcRenderer.invoke('git:unwatch-status', arg, watchId),
  onGitStatusChanged: (listener: (data: { taskPath: string; error?: string }) => void) => {
    attachGitStatusBridgeOnce();
    gitStatusChangedListeners.add(listener);
    return () => {
      gitStatusChangedListeners.delete(listener);
    };
  },
  getFileDiff: (args: {
    taskPath: string;
    taskId?: string;
    filePath: string;
    baseRef?: string;
    forceLarge?: boolean;
  }) => ipcRenderer.invoke('git:get-file-diff', args),
  updateIndex: (args: { taskPath: string; taskId?: string } & GitIndexUpdateArgs) =>
    ipcRenderer.invoke('git:update-index', args),
  revertFile: (args: { taskPath: string; taskId?: string; filePath: string }) =>
    ipcRenderer.invoke('git:revert-file', args),
  gitCommit: (args: { taskPath: string; message: string }) =>
    ipcRenderer.invoke('git:commit', args),
  gitPush: (args: { taskPath: string }) => ipcRenderer.invoke('git:push', args),
  gitPull: (args: { taskPath: string }) => ipcRenderer.invoke('git:pull', args),
  gitGetLog: (args: { taskPath: string; maxCount?: number; skip?: number }) =>
    ipcRenderer.invoke('git:get-log', args),
  gitGetLatestCommit: (args: { taskPath: string }) =>
    ipcRenderer.invoke('git:get-latest-commit', args),
  gitGetCommitFiles: (args: { taskPath: string; commitHash: string }) =>
    ipcRenderer.invoke('git:get-commit-files', args),
  gitGetCommitFileDiff: (args: {
    taskPath: string;
    commitHash: string;
    filePath: string;
    forceLarge?: boolean;
  }) => ipcRenderer.invoke('git:get-commit-file-diff', args),
  gitSoftReset: (args: { taskPath: string }) => ipcRenderer.invoke('git:soft-reset', args),
  gitCommitAndPush: (args: {
    taskPath: string;
    taskId?: string;
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
    skipPrePush?: boolean;
  }) => ipcRenderer.invoke('git:create-pr', args),
  mergeToMain: (args: { taskPath: string; taskId?: string }) =>
    ipcRenderer.invoke('git:merge-to-main', args),
  mergePr: (args: {
    taskPath: string;
    prNumber?: number;
    strategy?: 'merge' | 'squash' | 'rebase';
    admin?: boolean;
  }) => ipcRenderer.invoke('git:merge-pr', args),
  getPrStatus: (args: { taskPath: string }) => ipcRenderer.invoke('git:get-pr-status', args),
  enableAutoMerge: (args: {
    taskPath: string;
    prNumber?: number;
    strategy?: 'merge' | 'squash' | 'rebase';
  }) => ipcRenderer.invoke('git:enable-auto-merge', args),
  disableAutoMerge: (args: { taskPath: string; prNumber?: number }) =>
    ipcRenderer.invoke('git:disable-auto-merge', args),
  getCheckRuns: (args: { taskPath: string }) => ipcRenderer.invoke('git:get-check-runs', args),
  getPrComments: (args: { taskPath: string; prNumber?: number }) =>
    ipcRenderer.invoke('git:get-pr-comments', args),
  getBranchStatus: (args: { taskPath: string; taskId?: string }) =>
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

  // Emdash Account
  accountGetSession: () => ipcRenderer.invoke('account:getSession'),
  accountSignIn: () => ipcRenderer.invoke('account:signIn'),
  accountSignOut: () => ipcRenderer.invoke('account:signOut'),
  accountCheckServerHealth: () => ipcRenderer.invoke('account:checkServerHealth'),
  accountValidateSession: () => ipcRenderer.invoke('account:validateSession'),

  // GitHub integration
  githubAuth: () => ipcRenderer.invoke('github:auth'),
  githubAuthOAuth: () => ipcRenderer.invoke('github:auth:oauth'),
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
    template?: 'blank' | 't3' | 'vite-react' | 'gStack';
  }) => ipcRenderer.invoke('github:createNewProject', params),
  githubListPullRequests: (args: { projectPath: string; limit?: number; searchQuery?: string }) =>
    ipcRenderer.invoke('github:listPullRequests', args),
  githubCreatePullRequestWorktree: (args: {
    projectPath: string;
    projectId: string;
    prNumber: number;
    prTitle?: string;
    taskName?: string;
    branchName?: string;
  }) => ipcRenderer.invoke('github:createPullRequestWorktree', args),
  githubGetPullRequestBaseDiff: (args: { worktreePath: string; prNumber: number }) =>
    ipcRenderer.invoke('github:getPullRequestBaseDiff', args),
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
  // GitLab integration
  gitlabSaveCredentials: (args: { instanceUrl: string; token: string }) =>
    ipcRenderer.invoke('gitlab:saveCredentials', args),
  gitlabClearCredentials: () => ipcRenderer.invoke('gitlab:clearCredentials'),
  gitlabCheckConnection: () => ipcRenderer.invoke('gitlab:checkConnection'),
  gitlabInitialFetch: (projectPath: string, limit?: number) =>
    ipcRenderer.invoke('gitlab:initialFetch', { projectPath, limit }),
  gitlabSearchIssues: (projectPath: string, searchTerm: string, limit?: number) =>
    ipcRenderer.invoke('gitlab:searchIssues', { projectPath, searchTerm, limit }),
  // Plain integration
  plainSaveToken: (token: string) => ipcRenderer.invoke('plain:saveToken', token),
  plainCheckConnection: () => ipcRenderer.invoke('plain:checkConnection'),
  plainClearToken: () => ipcRenderer.invoke('plain:clearToken'),
  plainInitialFetch: (limit?: number, statuses?: string[]) =>
    ipcRenderer.invoke('plain:initialFetch', limit, statuses),
  plainSearchThreads: (searchTerm: string, limit?: number) =>
    ipcRenderer.invoke('plain:searchThreads', searchTerm, limit),

  // Sentry integration
  sentrySaveToken: (token: string, organizationSlug?: string) =>
    ipcRenderer.invoke('sentry:saveToken', token, organizationSlug),
  sentryCheckConnection: () => ipcRenderer.invoke('sentry:checkConnection'),
  sentryClearToken: () => ipcRenderer.invoke('sentry:clearToken'),
  sentryInitialFetch: (limit?: number) => ipcRenderer.invoke('sentry:initialFetch', limit),
  sentrySearchIssues: (searchTerm: string, limit?: number) =>
    ipcRenderer.invoke('sentry:searchIssues', searchTerm, limit),

  // Forgejo integration
  forgejoSaveCredentials: (args: { instanceUrl: string; token: string }) =>
    ipcRenderer.invoke('forgejo:saveCredentials', args),
  forgejoClearCredentials: () => ipcRenderer.invoke('forgejo:clearCredentials'),
  forgejoCheckConnection: () => ipcRenderer.invoke('forgejo:checkConnection'),
  forgejoInitialFetch: (projectPath: string, limit?: number) =>
    ipcRenderer.invoke('forgejo:initialFetch', { projectPath, limit }),
  forgejoSearchIssues: (projectPath: string, searchTerm: string, limit?: number) =>
    ipcRenderer.invoke('forgejo:searchIssues', { projectPath, searchTerm, limit }),
  getProviderStatuses: (opts?: { refresh?: boolean; providers?: string[]; providerId?: string }) =>
    ipcRenderer.invoke('providers:getStatuses', opts ?? {}),
  getProviderCustomConfig: (providerId: string) =>
    ipcRenderer.invoke('providers:getCustomConfig', providerId),
  getAllProviderCustomConfigs: () => ipcRenderer.invoke('providers:getAllCustomConfigs'),
  updateProviderCustomConfig: (providerId: string, config: any) =>
    ipcRenderer.invoke('providers:updateCustomConfig', providerId, config),

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
  skillsInstall: (args: { skillId: string; source?: { owner: string; repo: string } }) =>
    ipcRenderer.invoke('skills:install', args),
  skillsUninstall: (args: { skillId: string }) => ipcRenderer.invoke('skills:uninstall', args),
  skillsGetDetail: (args: { skillId: string; source?: { owner: string; repo: string } }) =>
    ipcRenderer.invoke('skills:getDetail', args),
  skillsGetDetectedAgents: () => ipcRenderer.invoke('skills:getDetectedAgents'),
  skillsSearch: (args: { query: string }) => ipcRenderer.invoke('skills:search', args),
  skillsCreate: (args: { name: string; description: string }) =>
    ipcRenderer.invoke('skills:create', args),

  // Workspace provisioning
  workspaceProvision: (args: {
    taskId: string;
    repoUrl: string;
    branch: string;
    baseRef: string;
    provisionCommand: string;
    projectPath: string;
  }) => ipcRenderer.invoke('workspace:provision', args),
  workspaceCancel: (args: { instanceId: string }) => ipcRenderer.invoke('workspace:cancel', args),
  workspaceTerminate: (args: {
    instanceId: string;
    terminateCommand: string;
    projectPath: string;
    env?: Record<string, string>;
  }) => ipcRenderer.invoke('workspace:terminate', args),
  workspaceStatus: (args: { taskId: string }) => ipcRenderer.invoke('workspace:status', args),
  onWorkspaceProvisionProgress: (
    listener: (data: { instanceId: string; line: string }) => void
  ) => {
    const channel = 'workspace:provision-progress';
    const wrapped = (_: Electron.IpcRendererEvent, data: { instanceId: string; line: string }) =>
      listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onWorkspaceProvisionTimeoutWarning: (
    listener: (data: { instanceId: string; timeoutMs: number }) => void
  ) => {
    const channel = 'workspace:provision-timeout-warning';
    const wrapped = (
      _: Electron.IpcRendererEvent,
      data: { instanceId: string; timeoutMs: number }
    ) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  onWorkspaceProvisionComplete: (
    listener: (data: { instanceId: string; status: string; error?: string }) => void
  ) => {
    const channel = 'workspace:provision-complete';
    const wrapped = (
      _: Electron.IpcRendererEvent,
      data: { instanceId: string; status: string; error?: string }
    ) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },

  // MCP
  mcpLoadAll: () => ipcRenderer.invoke('mcp:load-all'),
  mcpSaveServer: (server: McpServer) => ipcRenderer.invoke('mcp:save-server', server),
  mcpRemoveServer: (serverName: string) => ipcRenderer.invoke('mcp:remove-server', serverName),
  mcpGetProviders: () => ipcRenderer.invoke('mcp:get-providers'),
  mcpRefreshProviders: () => ipcRenderer.invoke('mcp:refresh-providers'),

  // Automations
  automationsList: () => ipcRenderer.invoke('automations:list'),
  automationsGet: (args: { id: string }) => ipcRenderer.invoke('automations:get', args),
  automationsCreate: (args: {
    name: string;
    projectId: string;
    projectName?: string;
    prompt: string;
    agentId: string;
    mode?: string;
    schedule: {
      type: string;
      hour?: number;
      minute?: number;
      dayOfWeek?: string;
      dayOfMonth?: number;
    };
    triggerType?: string;
    triggerConfig?: Record<string, unknown>;
    useWorktree?: boolean;
  }) => ipcRenderer.invoke('automations:create', args),
  automationsUpdate: (args: {
    id: string;
    name?: string;
    projectId?: string;
    projectName?: string;
    prompt?: string;
    agentId?: string;
    mode?: string;
    schedule?: {
      type: string;
      hour?: number;
      minute?: number;
      dayOfWeek?: string;
      dayOfMonth?: number;
    };
    triggerType?: string | null;
    triggerConfig?: Record<string, unknown> | null;
    status?: string;
    useWorktree?: boolean;
  }) => ipcRenderer.invoke('automations:update', args),
  automationsDelete: (args: { id: string }) => ipcRenderer.invoke('automations:delete', args),
  automationsToggle: (args: { id: string }) => ipcRenderer.invoke('automations:toggle', args),
  automationsRunLogs: (args: { automationId: string; limit?: number }) =>
    ipcRenderer.invoke('automations:runLogs', args),
  automationsTriggerNow: (args: { id: string }) =>
    ipcRenderer.invoke('automations:triggerNow', args),
  automationsCompleteRun: (args: {
    runLogId: string;
    automationId: string;
    taskId?: string;
    status: 'success' | 'failure';
    error?: string;
  }) => ipcRenderer.invoke('automations:completeRun', args),
  automationsDrainTriggers: () => ipcRenderer.invoke('automations:drainTriggers'),
  onAutomationTriggerAvailable: (listener: () => void) => {
    const wrapped = (_: Electron.IpcRendererEvent) => listener();
    ipcRenderer.on('automation:trigger-available', wrapped);
    return () => {
      ipcRenderer.removeListener('automation:trigger-available', wrapped);
    };
  },

  // Integrations
  integrationsStatusMap: () => ipcRenderer.invoke('integrations:statusMap'),

  // Performance Monitor
  perfSubscribe: () => ipcRenderer.invoke('perf:subscribe'),
  perfUnsubscribe: () => ipcRenderer.invoke('perf:unsubscribe'),
  perfGetSnapshot: (mode?: 'interactive' | 'idle') => ipcRenderer.invoke('perf:getSnapshot', mode),
  onPerfSnapshot: (listener: (snapshot: ResourceMetricsSnapshot) => void) => {
    const channel = 'perf:snapshot';
    const wrapped = (_: Electron.IpcRendererEvent, data: ResourceMetricsSnapshot) => listener(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
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
  ptyCleanupSessions: (args: {
    ids: string[];
    clearSnapshots?: boolean;
    waitForSnapshots?: boolean;
  }) => Promise<{
    ok: boolean;
    cleaned: number;
    failedIds: string[];
    snapshotClearQueued: boolean;
  }>;
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
  worktreePreflightReserve: (args: {
    projectId: string;
    projectPath: string;
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
    taskPath?: string;
    projectPath?: string;
    taskName?: string;
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
      additions: number | null;
      deletions: number | null;
      isStaged: boolean;
      diff?: string;
    }>;
    error?: string;
  }>;
  getDeleteRisks: (args: {
    targets: Array<{ id: string; taskPath: string }>;
    includePr?: boolean;
  }) => Promise<{
    success: boolean;
    risks?: Record<
      string,
      {
        staged: number;
        unstaged: number;
        untracked: number;
        files: string[];
        ahead: number;
        behind: number;
        error?: string;
        pr?: {
          number?: number;
          title?: string;
          url?: string;
          state?: string | null;
          isDraft?: boolean;
        } | null;
        prKnown: boolean;
      }
    >;
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
  getFileDiff: (args: {
    taskPath: string;
    filePath: string;
    baseRef?: string;
    forceLarge?: boolean;
  }) => Promise<{
    success: boolean;
    diff?: DiffPayload;
    error?: string;
  }>;
  updateIndex: (args: { taskPath: string } & GitIndexUpdateArgs) => Promise<{
    success: boolean;
    error?: string;
  }>;
  revertFile: (args: { taskPath: string; filePath: string }) => Promise<{
    success: boolean;
    action?: 'reverted';
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
    skipPrePush?: boolean;
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
  githubListPullRequests: (args: {
    projectPath: string;
    limit?: number;
  }) => Promise<{ success: boolean; prs?: any[]; totalCount?: number; error?: string }>;
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
    task?: {
      id: string;
      name: string;
      path: string;
      branch: string;
      projectId: string;
      status: string;
      agentId: string;
      metadata?: { prNumber?: number; prTitle?: string | null };
    };
    error?: string;
  }>;
  githubGetPullRequestBaseDiff: (args: { worktreePath: string; prNumber: number }) => Promise<{
    success: boolean;
    diff?: string;
    baseBranch?: string;
    headBranch?: string;
    prUrl?: string;
    error?: string;
  }>;
  githubLogout: () => Promise<void>;
  githubCheckCLIInstalled: () => Promise<boolean>;
  githubInstallCLI: () => Promise<{ success: boolean; error?: string }>;

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
