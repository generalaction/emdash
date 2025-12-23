// Updated for Codex integration
import type { ResolvedContainerConfig, RunnerEvent, RunnerMode } from '../../shared/container';
import type { ProviderId } from '../../shared/providers/registry';

type ProjectSettingsPayload = {
  projectId: string;
  name: string;
  path: string;
  gitRemote?: string;
  gitBranch?: string;
  baseRef?: string;
};

type CustomSlashCommand = {
  name: string;
  description?: string;
  source: 'project' | 'global';
  provider: ProviderId;
  filePath: string;
};

export {};

declare global {
  interface Window {
    electronAPI: {
      // App info
      getAppVersion: () => Promise<string>;
      getElectronVersion: () => Promise<string>;
      getPlatform: () => Promise<string>;
      // Updater
      checkForUpdates: () => Promise<{ success: boolean; result?: any; error?: string }>;
      downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
      quitAndInstallUpdate: () => Promise<{ success: boolean; error?: string }>;
      openLatestDownload: () => Promise<{ success: boolean; error?: string }>;
      onUpdateEvent: (listener: (data: { type: string; payload?: any }) => void) => () => void;

      // App settings
      getSettings: () => Promise<{
        success: boolean;
        settings?: {
          repository: { branchTemplate: string; pushOnCreate: boolean };
          projectPrep?: { autoInstallOnOpenInEditor: boolean };
          browserPreview?: { enabled: boolean; engine: 'chromium' };
          notifications?: { enabled: boolean; sound: boolean };
          mcp?: {
            context7?: {
              enabled: boolean;
              installHintsDismissed?: Record<string, boolean>;
            };
          };
          chatUi?: {
            enabled: boolean;
          };
          defaultProvider?: string;
          tasks?: {
            autoGenerateName: boolean;
            autoApproveByDefault: boolean;
          };
          projects?: {
            defaultDirectory: string;
          };
        };
        error?: string;
      }>;
      updateSettings: (
        settings: Partial<{
          repository: { branchTemplate?: string; pushOnCreate?: boolean };
          projectPrep: { autoInstallOnOpenInEditor?: boolean };
          browserPreview: { enabled?: boolean; engine?: 'chromium' };
          notifications: { enabled?: boolean; sound?: boolean };
          mcp: {
            context7?: {
              enabled?: boolean;
              installHintsDismissed?: Record<string, boolean>;
            };
          };
          chatUi: {
            enabled?: boolean;
          };
          defaultProvider?: string;
          tasks?: {
            autoGenerateName?: boolean;
            autoApproveByDefault?: boolean;
          };
          projects?: {
            defaultDirectory?: string;
          };
        }>
      ) => Promise<{
        success: boolean;
        settings?: {
          repository: { branchTemplate: string; pushOnCreate: boolean };
          projectPrep?: { autoInstallOnOpenInEditor: boolean };
          browserPreview?: { enabled: boolean; engine: 'chromium' };
          notifications?: { enabled: boolean; sound: boolean };
          mcp?: {
            context7?: {
              enabled: boolean;
              installHintsDismissed?: Record<string, boolean>;
            };
          };
          chatUi?: {
            enabled: boolean;
          };
          defaultProvider?: string;
          tasks?: {
            autoGenerateName: boolean;
            autoApproveByDefault: boolean;
          };
          projects?: {
            defaultDirectory: string;
          };
        };
        error?: string;
      }>;
      onSettingsUpdated: (listener: (settings: any) => void) => () => void;

      // PTY
      ptyStart: (opts: {
        id: string;
        cwd?: string;
        shell?: string;
        env?: Record<string, string>;
        cols?: number;
        rows?: number;
        autoApprove?: boolean;
        initialPrompt?: string;
        skipResume?: boolean;
      }) => Promise<{ ok: boolean; error?: string }>;
      ptyInput: (args: { id: string; data: string }) => void;
      ptyResize: (args: { id: string; cols: number; rows?: number }) => void;
      ptyKill: (id: string) => void;
      onPtyData: (id: string, listener: (data: string) => void) => () => void;
      ptyGetSnapshot: (args: { id: string }) => Promise<{
        ok: boolean;
        snapshot?: any;
        error?: string;
      }>;
      ptySaveSnapshot: (args: { id: string; payload: TerminalSnapshotPayload }) => Promise<{
        ok: boolean;
        error?: string;
      }>;
      ptyClearSnapshot: (args: { id: string }) => Promise<{ ok: boolean }>;
      onPtyExit: (
        id: string,
        listener: (info: { exitCode: number; signal?: number }) => void
      ) => () => void;
      onPtyStarted: (listener: (data: { id: string }) => void) => () => void;
      terminalGetTheme: () => Promise<{
        ok: boolean;
        config?: {
          terminal: string;
          theme: {
            background?: string;
            foreground?: string;
            cursor?: string;
            cursorAccent?: string;
            selectionBackground?: string;
            black?: string;
            red?: string;
            green?: string;
            yellow?: string;
            blue?: string;
            magenta?: string;
            cyan?: string;
            white?: string;
            brightBlack?: string;
            brightRed?: string;
            brightGreen?: string;
            brightYellow?: string;
            brightBlue?: string;
            brightMagenta?: string;
            brightCyan?: string;
            brightWhite?: string;
            fontFamily?: string;
            fontSize?: number;
          };
        };
        error?: string;
      }>;

      // ACP (Agent Client Protocol)
      acpStartSession: (args: {
        taskId: string;
        providerId: string;
        cwd: string;
      }) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
      acpSendPrompt: (args: {
        sessionId: string;
        prompt: Array<{ type: string; [key: string]: any }>;
      }) => Promise<{ success: boolean; stopReason?: string; error?: string }>;
      acpCancel: (args: { sessionId: string }) => Promise<{ success: boolean }>;
      acpDispose: (args: { sessionId: string }) => Promise<{ success: boolean }>;
      acpRespondPermission: (args: {
        sessionId: string;
        requestId: number;
        outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };
      }) => Promise<{ success: boolean; error?: string }>;
      acpSetMode: (args: { sessionId: string; modeId: string }) => Promise<{
        success: boolean;
        error?: string;
      }>;
      acpSetModel: (args: { sessionId: string; modelId: string }) => Promise<{
        success: boolean;
        error?: string;
      }>;
      acpSetConfigOption: (args: {
        sessionId: string;
        configId: string;
        value: unknown;
      }) => Promise<{
        success: boolean;
        error?: string;
      }>;
      onAcpEvent: (listener: (payload: any) => void) => () => void;
      scanCustomCommands: (args: { projectPath: string; providerId: string }) => Promise<{
        success: boolean;
        commands?: CustomSlashCommand[];
        error?: string;
      }>;

      // Worktree management
      worktreeCreate: (args: {
        projectPath: string;
        taskName: string;
        projectId: string;
        autoApprove?: boolean;
      }) => Promise<{ success: boolean; worktree?: any; error?: string }>;
      worktreeList: (args: {
        projectPath: string;
      }) => Promise<{ success: boolean; worktrees?: any[]; error?: string }>;
      worktreeRemove: (args: {
        projectPath: string;
        worktreeId: string;
        worktreePath?: string;
        branch?: string;
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
      worktreeGetAll: () => Promise<{
        success: boolean;
        worktrees?: any[];
        error?: string;
      }>;

      // Project management
      openProject: () => Promise<{
        success: boolean;
        path?: string;
        error?: string;
      }>;
      getProjectSettings: (projectId: string) => Promise<{
        success: boolean;
        settings?: ProjectSettingsPayload;
        error?: string;
      }>;
      updateProjectSettings: (args: { projectId: string; baseRef: string }) => Promise<{
        success: boolean;
        settings?: ProjectSettingsPayload;
        error?: string;
      }>;
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
          isStaged: boolean;
          diff?: string;
        }>;
        error?: string;
      }>;
      getFileDiff: (args: { taskPath: string; filePath: string }) => Promise<{
        success: boolean;
        diff?: {
          lines: Array<{
            left?: string;
            right?: string;
            type: 'context' | 'add' | 'del';
          }>;
        };
        error?: string;
      }>;
      stageFile: (args: { taskPath: string; filePath: string }) => Promise<{
        success: boolean;
        error?: string;
      }>;
      revertFile: (args: { taskPath: string; filePath: string }) => Promise<{
        success: boolean;
        action?: 'unstaged' | 'reverted';
        error?: string;
      }>;
      gitCommitAndPush: (args: {
        taskPath: string;
        commitMessage?: string;
        createBranchIfOnDefault?: boolean;
        branchPrefix?: string;
      }) => Promise<{
        success: boolean;
        branch?: string;
        output?: string;
        error?: string;
      }>;
      generatePrContent: (args: { taskPath: string; base?: string }) => Promise<{
        success: boolean;
        title?: string;
        description?: string;
        error?: string;
      }>;
      createPullRequest: (args: {
        taskPath: string;
        title?: string;
        body?: string;
        base?: string;
        head?: string;
        draft?: boolean;
        web?: boolean;
        fill?: boolean;
      }) => Promise<{
        success: boolean;
        url?: string;
        output?: string;
        error?: string;
      }>;
      getPrStatus: (args: { taskPath: string }) => Promise<{
        success: boolean;
        pr?: {
          number: number;
          url: string;
          state: string;
          isDraft?: boolean;
          mergeStateStatus?: string;
          headRefName?: string;
          baseRefName?: string;
          title?: string;
          author?: any;
          additions?: number;
          deletions?: number;
          changedFiles?: number;
        } | null;
        error?: string;
      }>;
      getBranchStatus: (args: { taskPath: string }) => Promise<{
        success: boolean;
        branch?: string;
        defaultBranch?: string;
        ahead?: number;
        behind?: number;
        error?: string;
      }>;
      listRemoteBranches: (args: { projectPath: string; remote?: string }) => Promise<{
        success: boolean;
        branches?: Array<{ ref: string; remote: string; branch: string; label: string }>;
        error?: string;
      }>;
      loadContainerConfig: (taskPath: string) => Promise<
        | {
            ok: true;
            config: ResolvedContainerConfig;
            sourcePath: string | null;
          }
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
        taskId: string;
        taskPath: string;
        runId?: string;
        mode?: RunnerMode;
      }) => Promise<
        | {
            ok: true;
            runId: string;
            sourcePath: string | null;
          }
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
      stopContainerRun: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
      openIn: (args: {
        app: 'finder' | 'cursor' | 'vscode' | 'terminal' | 'ghostty' | 'zed' | 'iterm2' | 'warp';
        path: string;
      }) => Promise<{ success: boolean; error?: string }>;
      connectToGitHub: (projectPath: string) => Promise<{
        success: boolean;
        repository?: string;
        branch?: string;
        error?: string;
      }>;
      // Telemetry
      captureTelemetry: (
        event: string,
        properties?: Record<string, any>
      ) => Promise<{ success: boolean; disabled?: boolean; error?: string }>;
      getTelemetryStatus: () => Promise<{
        success: boolean;
        status?: {
          enabled: boolean;
          envDisabled: boolean;
          userOptOut: boolean;
          hasKeyAndHost: boolean;
          onboardingSeen?: boolean;
        };
        error?: string;
      }>;
      setTelemetryEnabled: (enabled: boolean) => Promise<{
        success: boolean;
        status?: {
          enabled: boolean;
          envDisabled: boolean;
          userOptOut: boolean;
          hasKeyAndHost: boolean;
          onboardingSeen?: boolean;
        };
        error?: string;
      }>;
      setOnboardingSeen: (flag: boolean) => Promise<{
        success: boolean;
        status?: {
          enabled: boolean;
          envDisabled: boolean;
          userOptOut: boolean;
          hasKeyAndHost: boolean;
          onboardingSeen?: boolean;
        };
        error?: string;
      }>;

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
      fsWriteFile: (
        root: string,
        relPath: string,
        content: string,
        mkdirs?: boolean
      ) => Promise<{ success: boolean; error?: string }>;
      fsRemove: (root: string, relPath: string) => Promise<{ success: boolean; error?: string }>;
      // Attachments
      saveAttachment: (args: { taskPath: string; srcPath: string; subdir?: string }) => Promise<{
        success: boolean;
        absPath?: string;
        relPath?: string;
        fileName?: string;
        error?: string;
      }>;

      // Run events
      onRunEvent: (callback: (event: RunnerEvent) => void) => void;
      removeRunEventListeners: () => void;

      // GitHub integration
      githubAuth: () => Promise<{
        success: boolean;
        token?: string;
        user?: any;
        device_code?: string;
        user_code?: string;
        verification_uri?: string;
        expires_in?: number;
        interval?: number;
        error?: string;
      }>;
      githubCancelAuth: () => Promise<{ success: boolean; error?: string }>;
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
      onGithubAuthError: (
        callback: (data: { error: string; message: string }) => void
      ) => () => void;
      onGithubAuthCancelled: (callback: () => void) => () => void;
      onGithubAuthUserUpdated: (callback: (data: { user: any }) => void) => () => void;
      githubIsAuthenticated: () => Promise<boolean>;
      githubGetStatus: () => Promise<{
        installed: boolean;
        authenticated: boolean;
        user?: any;
      }>;
      githubGetUser: () => Promise<any>;
      githubGetRepositories: () => Promise<any[]>;
      githubCloneRepository: (
        repoUrl: string,
        localPath: string
      ) => Promise<{ success: boolean; error?: string }>;
      githubGetOwners: () => Promise<{
        success: boolean;
        owners?: Array<{ login: string; type: 'User' | 'Organization' }>;
        error?: string;
      }>;
      githubValidateRepoName: (
        name: string,
        owner: string
      ) => Promise<{
        success: boolean;
        valid?: boolean;
        exists?: boolean;
        error?: string;
      }>;
      githubCreateNewProject: (params: {
        name: string;
        description?: string;
        owner: string;
        isPrivate: boolean;
        gitignoreTemplate?: string;
      }) => Promise<{
        success: boolean;
        projectPath?: string;
        repoUrl?: string;
        fullName?: string;
        defaultBranch?: string;
        githubRepoCreated?: boolean;
        error?: string;
      }>;
      githubCheckCLIInstalled: () => Promise<boolean>;
      githubInstallCLI: () => Promise<{ success: boolean; error?: string }>;
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
      // Linear integration
      linearCheckConnection?: () => Promise<{
        connected: boolean;
        taskName?: string;
        error?: string;
      }>;
      linearSaveToken?: (token: string) => Promise<{
        success: boolean;
        taskName?: string;
        error?: string;
      }>;
      linearClearToken?: () => Promise<{
        success: boolean;
        error?: string;
      }>;
      linearInitialFetch?: (limit?: number) => Promise<{
        success: boolean;
        issues?: any[];
        error?: string;
      }>;
      linearSearchIssues?: (
        searchTerm: string,
        limit?: number
      ) => Promise<{
        success: boolean;
        issues?: any[];
        error?: string;
      }>;
      // Jira integration
      jiraSaveCredentials?: (args: {
        siteUrl: string;
        email: string;
        token: string;
      }) => Promise<{ success: boolean; displayName?: string; error?: string }>;
      jiraClearCredentials?: () => Promise<{ success: boolean; error?: string }>;
      jiraCheckConnection?: () => Promise<{
        connected: boolean;
        displayName?: string;
        siteUrl?: string;
        error?: string;
      }>;
      jiraInitialFetch?: (limit?: number) => Promise<{
        success: boolean;
        issues?: any[];
        error?: string;
      }>;
      jiraSearchIssues?: (
        searchTerm: string,
        limit?: number
      ) => Promise<{ success: boolean; issues?: any[]; error?: string }>;
      getProviderStatuses?: (opts?: {
        refresh?: boolean;
        providers?: string[];
        providerId?: string;
      }) => Promise<{
        success: boolean;
        statuses?: Record<
          string,
          { installed: boolean; path?: string | null; version?: string | null; lastChecked: number }
        >;
        error?: string;
      }>;
      onProviderStatusUpdated?: (
        listener: (data: { providerId: string; status: any }) => void
      ) => () => void;

      // Database operations
      getProjects: () => Promise<any[]>;
      saveProject: (project: any) => Promise<{ success: boolean; error?: string }>;
      getTasks: (projectId?: string) => Promise<any[]>;
      saveTask: (task: any) => Promise<{ success: boolean; error?: string }>;
      deleteProject: (projectId: string) => Promise<{ success: boolean; error?: string }>;
      deleteTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;

      // Message operations
      saveMessage: (message: any) => Promise<{ success: boolean; error?: string }>;
      getMessages: (
        conversationId: string
      ) => Promise<{ success: boolean; messages?: any[]; error?: string }>;
      getOrCreateDefaultConversation: (
        taskId: string
      ) => Promise<{ success: boolean; conversation?: any; error?: string }>;

      // Debug helpers
      debugAppendLog: (
        filePath: string,
        content: string,
        options?: { reset?: boolean }
      ) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

// Explicit type export for better TypeScript recognition
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

  // PTY
  ptyStart: (opts: {
    id: string;
    cwd?: string;
    shell?: string;
    env?: Record<string, string>;
    cols?: number;
    rows?: number;
    autoApprove?: boolean;
    initialPrompt?: string;
    skipResume?: boolean;
  }) => Promise<{ ok: boolean; error?: string }>;
  ptyInput: (args: { id: string; data: string }) => void;
  ptyResize: (args: { id: string; cols: number; rows?: number }) => void;
  ptyKill: (id: string) => void;
  onPtyData: (id: string, listener: (data: string) => void) => () => void;
  ptyGetSnapshot: (args: { id: string }) => Promise<{
    ok: boolean;
    snapshot?: any;
    error?: string;
  }>;
  ptySaveSnapshot: (args: { id: string; payload: TerminalSnapshotPayload }) => Promise<{
    ok: boolean;
    error?: string;
  }>;
  ptyClearSnapshot: (args: { id: string }) => Promise<{ ok: boolean }>;
  onPtyExit: (
    id: string,
    listener: (info: { exitCode: number; signal?: number }) => void
  ) => () => void;
  onPtyStarted: (listener: (data: { id: string }) => void) => () => void;

  // Worktree management
  worktreeCreate: (args: {
    projectPath: string;
    taskName: string;
    projectId: string;
    autoApprove?: boolean;
  }) => Promise<{ success: boolean; worktree?: any; error?: string }>;
  worktreeList: (args: {
    projectPath: string;
  }) => Promise<{ success: boolean; worktrees?: any[]; error?: string }>;
  worktreeRemove: (args: {
    projectPath: string;
    worktreeId: string;
    worktreePath?: string;
    branch?: string;
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
  worktreeGetAll: () => Promise<{
    success: boolean;
    worktrees?: any[];
    error?: string;
  }>;

  // Project management
  openProject: () => Promise<{
    success: boolean;
    path?: string;
    error?: string;
  }>;
  getProjectSettings: (projectId: string) => Promise<{
    success: boolean;
    settings?: ProjectSettingsPayload;
    error?: string;
  }>;
  updateProjectSettings: (args: { projectId: string; baseRef: string }) => Promise<{
    success: boolean;
    settings?: ProjectSettingsPayload;
    error?: string;
  }>;
  getGitInfo: (projectPath: string) => Promise<{
    isGitRepo: boolean;
    remote?: string;
    branch?: string;
    baseRef?: string;
    upstream?: string;
    aheadCount?: number;
    behindCount?: number;
    path?: string;
    error?: string;
  }>;
  listRemoteBranches: (args: { projectPath: string; remote?: string }) => Promise<{
    success: boolean;
    branches?: Array<{ ref: string; remote: string; branch: string; label: string }>;
    error?: string;
  }>;
  createPullRequest: (args: {
    taskPath: string;
    title?: string;
    body?: string;
    base?: string;
    head?: string;
    draft?: boolean;
    web?: boolean;
    fill?: boolean;
  }) => Promise<{
    success: boolean;
    url?: string;
    output?: string;
    error?: string;
  }>;
  connectToGitHub: (projectPath: string) => Promise<{
    success: boolean;
    repository?: string;
    branch?: string;
    error?: string;
  }>;
  getProviderStatuses?: (opts?: {
    refresh?: boolean;
    providers?: string[];
    providerId?: string;
  }) => Promise<{
    success: boolean;
    statuses?: Record<
      string,
      { installed: boolean; path?: string | null; version?: string | null; lastChecked: number }
    >;
    error?: string;
  }>;
  onProviderStatusUpdated?: (
    listener: (data: { providerId: string; status: any }) => void
  ) => () => void;
  // Telemetry
  captureTelemetry: (
    event: string,
    properties?: Record<string, any>
  ) => Promise<{ success: boolean; disabled?: boolean; error?: string }>;
  getTelemetryStatus: () => Promise<{
    success: boolean;
    status?: {
      enabled: boolean;
      envDisabled: boolean;
      userOptOut: boolean;
      hasKeyAndHost: boolean;
      onboardingSeen?: boolean;
    };
    error?: string;
  }>;
  setTelemetryEnabled: (enabled: boolean) => Promise<{
    success: boolean;
    status?: {
      enabled: boolean;
      envDisabled: boolean;
      userOptOut: boolean;
      hasKeyAndHost: boolean;
      onboardingSeen?: boolean;
    };
    error?: string;
  }>;

  // Filesystem
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

  // Run events
  onRunEvent: (callback: (event: RunnerEvent) => void) => void;
  removeRunEventListeners: () => void;

  // GitHub integration
  githubAuth: () => Promise<{
    success: boolean;
    token?: string;
    user?: any;
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error?: string;
  }>;
  githubCancelAuth: () => Promise<{ success: boolean; error?: string }>;
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
  githubGetUser: () => Promise<any>;
  githubGetRepositories: () => Promise<any[]>;
  githubCloneRepository: (
    repoUrl: string,
    localPath: string
  ) => Promise<{ success: boolean; error?: string }>;
  githubGetStatus?: () => Promise<{
    installed: boolean;
    authenticated: boolean;
    user?: any;
  }>;
  githubCheckCLIInstalled?: () => Promise<boolean>;
  githubInstallCLI?: () => Promise<{ success: boolean; error?: string }>;
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
  // GitHub issues
  githubIssuesList?: (
    projectPath: string,
    limit?: number
  ) => Promise<{ success: boolean; issues?: any[]; error?: string }>;
  githubIssuesSearch?: (
    projectPath: string,
    searchTerm: string,
    limit?: number
  ) => Promise<{ success: boolean; issues?: any[]; error?: string }>;
  githubIssueGet?: (
    projectPath: string,
    number: number
  ) => Promise<{ success: boolean; issue?: any; error?: string }>;

  // Linear integration
  linearCheckConnection?: () => Promise<{
    connected: boolean;
    taskName?: string;
    error?: string;
  }>;
  linearSaveToken?: (token: string) => Promise<{
    success: boolean;
    taskName?: string;
    error?: string;
  }>;
  linearClearToken?: () => Promise<{
    success: boolean;
    error?: string;
  }>;
  linearInitialFetch?: (limit?: number) => Promise<{
    success: boolean;
    issues?: any[];
    error?: string;
  }>;
  linearSearchIssues?: (
    searchTerm: string,
    limit?: number
  ) => Promise<{
    success: boolean;
    issues?: any[];
    error?: string;
  }>;

  // Database operations
  getProjects: () => Promise<any[]>;
  saveProject: (project: any) => Promise<{ success: boolean; error?: string }>;
  getTasks: (projectId?: string) => Promise<any[]>;
  saveTask: (task: any) => Promise<{ success: boolean; error?: string }>;
  deleteProject: (projectId: string) => Promise<{ success: boolean; error?: string }>;
  deleteTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;

  // Message operations
  saveMessage: (message: any) => Promise<{ success: boolean; error?: string }>;
  getMessages: (
    conversationId: string
  ) => Promise<{ success: boolean; messages?: any[]; error?: string }>;
  getOrCreateDefaultConversation: (
    taskId: string
  ) => Promise<{ success: boolean; conversation?: any; error?: string }>;

  // Debug helpers
  debugAppendLog: (
    filePath: string,
    content: string,
    options?: { reset?: boolean }
  ) => Promise<{ success: boolean; error?: string }>;
}
import type { TerminalSnapshotPayload } from '#types/terminalSnapshot';
