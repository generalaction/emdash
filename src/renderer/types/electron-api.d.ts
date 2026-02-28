// Updated for Codex integration

import type { AgentEvent } from '../../shared/agentEvents';

type ProjectSettingsPayload = {
  projectId: string;
  name: string;
  path: string;
  gitRemote?: string;
  gitBranch?: string;
  baseRef?: string;
};

export type LineComment = {
  id: string;
  taskId: string;
  filePath: string;
  lineNumber: number;
  lineContent?: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string | null;
};

export type ProviderCustomConfig = {
  cli?: string;
  resumeFlag?: string;
  defaultArgs?: string;
  autoApproveFlag?: string;
  initialPromptFlag?: string;
  extraArgs?: string;
  env?: Record<string, string>;
};

export type ProviderCustomConfigs = Record<string, ProviderCustomConfig>;

export {};

declare global {
  interface Window {
    electronAPI: {
      // App info
      getAppVersion: () => Promise<string>;
      getElectronVersion: () => Promise<string>;
      getPlatform: () => Promise<string>;
      listInstalledFonts: (args?: {
        refresh?: boolean;
      }) => Promise<{ success: boolean; fonts?: string[]; cached?: boolean; error?: string }>;
      undo: () => Promise<{ success: boolean; error?: string }>;
      redo: () => Promise<{ success: boolean; error?: string }>;
      // Updater
      checkForUpdates: () => Promise<{ success: boolean; result?: any; error?: string }>;
      downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
      quitAndInstallUpdate: () => Promise<{ success: boolean; error?: string }>;
      openLatestDownload: () => Promise<{ success: boolean; error?: string }>;
      onUpdateEvent: (listener: (data: { type: string; payload?: any }) => void) => () => void;
      // Enhanced update methods
      getUpdateState: () => Promise<{ success: boolean; data?: any; error?: string }>;
      getUpdateSettings: () => Promise<{ success: boolean; data?: any; error?: string }>;
      updateUpdateSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;
      getReleaseNotes: () => Promise<{ success: boolean; data?: string | null; error?: string }>;
      checkForUpdatesNow: () => Promise<{ success: boolean; data?: any; error?: string }>;

      // Menu events (main → renderer)
      onMenuOpenSettings: (listener: () => void) => () => void;
      onMenuCheckForUpdates: (listener: () => void) => () => void;
      onMenuUndo: (listener: () => void) => () => void;
      onMenuRedo: (listener: () => void) => () => void;

      // App settings
      getSettings: () => Promise<{
        success: boolean;
        settings?: {
          repository: { branchPrefix: string; pushOnCreate: boolean };
          projectPrep?: { autoInstallOnOpenInEditor: boolean };
          browserPreview?: { enabled: boolean; engine: 'chromium' };
          notifications?: {
            enabled: boolean;
            sound: boolean;
            osNotifications: boolean;
            soundFocusMode: 'always' | 'unfocused';
          };
          mcp?: {
            context7?: {
              enabled: boolean;
              installHintsDismissed?: Record<string, boolean>;
            };
          };
          defaultProvider?: string;
          tasks?: {
            autoGenerateName: boolean;
            autoApproveByDefault: boolean;
            autoTrustWorktrees: boolean;
          };
          projects?: {
            defaultDirectory: string;
          };
          keyboard?: {
            commandPalette?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            settings?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleLeftSidebar?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleRightSidebar?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleTheme?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleKanban?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleEditor?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            nextProject?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            prevProject?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            newTask?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            nextAgent?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            prevAgent?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
          };
          interface?: {
            autoRightSidebarBehavior?: boolean;
            theme?: 'light' | 'dark' | 'dark-black' | 'system';
          };
          terminal?: {
            fontFamily: string;
          };
          defaultOpenInApp?: string;
          hiddenOpenInApps?: string[];
        };
        error?: string;
      }>;
      updateSettings: (
        settings: Partial<{
          repository: { branchPrefix?: string; pushOnCreate?: boolean };
          projectPrep: { autoInstallOnOpenInEditor?: boolean };
          browserPreview: { enabled?: boolean; engine?: 'chromium' };
          notifications: {
            enabled?: boolean;
            sound?: boolean;
            osNotifications?: boolean;
            soundFocusMode?: 'always' | 'unfocused';
          };
          mcp: {
            context7?: {
              enabled?: boolean;
              installHintsDismissed?: Record<string, boolean>;
            };
          };
          defaultProvider?: string;
          tasks?: {
            autoGenerateName?: boolean;
            autoApproveByDefault?: boolean;
            autoTrustWorktrees?: boolean;
          };
          projects?: {
            defaultDirectory?: string;
          };
          keyboard?: {
            commandPalette?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            settings?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleLeftSidebar?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleRightSidebar?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleTheme?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleKanban?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleEditor?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            nextProject?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            prevProject?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            newTask?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            nextAgent?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            prevAgent?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
          };
          interface?: {
            autoRightSidebarBehavior?: boolean;
            theme?: 'light' | 'dark' | 'dark-black' | 'system';
          };
          terminal?: {
            fontFamily?: string;
          };
          defaultOpenInApp?: string;
          hiddenOpenInApps?: string[];
        }>
      ) => Promise<{
        success: boolean;
        settings?: {
          repository: { branchPrefix: string; pushOnCreate: boolean };
          projectPrep?: { autoInstallOnOpenInEditor: boolean };
          browserPreview?: { enabled: boolean; engine: 'chromium' };
          notifications?: {
            enabled: boolean;
            sound: boolean;
            osNotifications: boolean;
            soundFocusMode: 'always' | 'unfocused';
          };
          mcp?: {
            context7?: {
              enabled: boolean;
              installHintsDismissed?: Record<string, boolean>;
            };
          };
          defaultProvider?: string;
          tasks?: {
            autoGenerateName: boolean;
            autoApproveByDefault: boolean;
            autoTrustWorktrees: boolean;
          };
          projects?: {
            defaultDirectory: string;
          };
          keyboard?: {
            commandPalette?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            settings?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleLeftSidebar?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleRightSidebar?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleTheme?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleKanban?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            toggleEditor?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            nextProject?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            prevProject?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            newTask?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            nextAgent?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
            prevAgent?: {
              key: string;
              modifier: 'cmd' | 'ctrl' | 'shift' | 'alt' | 'option' | 'cmd+shift' | 'ctrl+shift';
            };
          };
          interface?: {
            autoRightSidebarBehavior?: boolean;
            theme?: 'light' | 'dark' | 'dark-black' | 'system';
          };
          terminal?: {
            fontFamily: string;
          };
          defaultOpenInApp?: string;
          hiddenOpenInApps?: string[];
        };
        error?: string;
      }>;

      // PTY
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
        skipResume?: boolean;
      }) => Promise<{ ok: boolean; error?: string }>;
      ptyStartDirect: (opts: {
        id: string;
        providerId: string;
        cwd: string;
        remote?: { connectionId: string };
        cols?: number;
        rows?: number;
        autoApprove?: boolean;
        initialPrompt?: string;
        env?: Record<string, string>;
        resume?: boolean;
      }) => Promise<{ ok: boolean; reused?: boolean; error?: string }>;
      ptyScpToRemote: (args: { connectionId: string; localPaths: string[] }) => Promise<{
        success: boolean;
        remotePaths?: string[];
        error?: string;
      }>;
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
      onAgentEvent: (
        listener: (event: AgentEvent, meta: { appFocused: boolean }) => void
      ) => () => void;
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
      worktreeGetAll: () => Promise<{
        success: boolean;
        worktrees?: any[];
        error?: string;
      }>;

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
        projectPath?: string;
        isRemote?: boolean;
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
        taskName?: string;
      }) => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
      lifecycleRunStart: (args: {
        taskId: string;
        taskPath: string;
        projectPath: string;
        taskName?: string;
      }) => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
      lifecycleRunStop: (args: {
        taskId: string;
      }) => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
      lifecycleTeardown: (args: {
        taskId: string;
        taskPath: string;
        projectPath: string;
        taskName?: string;
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
      lifecycleClearTask: (args: {
        taskId: string;
      }) => Promise<{ success: boolean; error?: string }>;
      onLifecycleEvent: (listener: (data: any) => void) => () => void;

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
      stageAllFiles: (args: { taskPath: string }) => Promise<{
        success: boolean;
        error?: string;
      }>;
      unstageFile: (args: { taskPath: string; filePath: string }) => Promise<{
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
      mergeToMain: (args: { taskPath: string }) => Promise<{
        success: boolean;
        output?: string;
        prUrl?: string;
        error?: string;
      }>;
      mergePr: (args: {
        taskPath: string;
        prNumber?: number;
        strategy?: 'merge' | 'squash' | 'rebase';
        admin?: boolean;
      }) => Promise<{
        success: boolean;
        output?: string;
        error?: string;
        code?: string;
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
      getCheckRuns: (args: { taskPath: string }) => Promise<{
        success: boolean;
        checks?: Array<{
          name: string;
          state: string;
          bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';
          description?: string;
          link?: string;
          workflow?: string;
          event?: string;
          startedAt?: string;
          completedAt?: string;
        }> | null;
        error?: string;
        code?: string;
      }>;
      getPrComments: (args: { taskPath: string; prNumber?: number }) => Promise<{
        success: boolean;
        comments?: Array<{
          id: string;
          author: { login: string; avatarUrl?: string };
          body: string;
          createdAt: string;
        }>;
        reviews?: Array<{
          id: string;
          author: { login: string; avatarUrl?: string };
          body: string;
          submittedAt: string;
          state: string;
        }>;
        error?: string;
        code?: string;
      }>;
      getBranchStatus: (args: { taskPath: string }) => Promise<{
        success: boolean;
        branch?: string;
        defaultBranch?: string;
        ahead?: number;
        behind?: number;
        error?: string;
      }>;
      renameBranch: (args: { repoPath: string; oldBranch: string; newBranch: string }) => Promise<{
        success: boolean;
        remotePushed?: boolean;
        error?: string;
      }>;
      listRemoteBranches: (args: { projectPath: string; remote?: string }) => Promise<{
        success: boolean;
        branches?: Array<{ ref: string; remote: string; branch: string; label: string }>;
        error?: string;
      }>;
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
      clipboardWriteText: (text: string) => Promise<{ success: boolean; error?: string }>;
      paste: () => Promise<{ success: boolean; error?: string }>;
      openIn: (args: {
        app: OpenInAppId;
        path: string;
        isRemote?: boolean;
        sshConnectionId?: string | null;
      }) => Promise<{ success: boolean; error?: string }>;
      checkInstalledApps: () => Promise<Record<OpenInAppId, boolean>>;
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
        opts?: {
          includeDirs?: boolean;
          maxEntries?: number;
          timeBudgetMs?: number;
          connectionId?: string;
          remotePath?: string;
          recursive?: boolean;
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
      fsReadImage: (
        root: string,
        relPath: string,
        remote?: { connectionId: string; remotePath: string }
      ) => Promise<{
        success: boolean;
        dataUrl?: string;
        mimeType?: string;
        size?: number;
        error?: string;
      }>;
      fsSearchContent: (
        root: string,
        query: string,
        options?: {
          caseSensitive?: boolean;
          maxResults?: number;
          fileExtensions?: string[];
        },
        remote?: { connectionId: string; remotePath: string }
      ) => Promise<{
        success: boolean;
        results?: Array<{
          file: string;
          matches: Array<{
            line: number;
            column: number;
            text: string;
            preview: string;
          }>;
        }>;
        error?: string;
      }>;
      fsWriteFile: (
        root: string,
        relPath: string,
        content: string,
        mkdirs?: boolean,
        remote?: { connectionId: string; remotePath: string }
      ) => Promise<{ success: boolean; error?: string }>;
      fsRemove: (
        root: string,
        relPath: string,
        remote?: { connectionId: string; remotePath: string }
      ) => Promise<{ success: boolean; error?: string }>;
      getProjectConfig: (
        projectPath: string
      ) => Promise<{ success: boolean; path?: string; content?: string; error?: string }>;
      saveProjectConfig: (
        projectPath: string,
        content: string
      ) => Promise<{ success: boolean; path?: string; error?: string }>;
      // Attachments
      saveAttachment: (args: { taskPath: string; srcPath: string; subdir?: string }) => Promise<{
        success: boolean;
        absPath?: string;
        relPath?: string;
        fileName?: string;
        error?: string;
      }>;

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
      getProviderCustomConfig?: (providerId: string) => Promise<{
        success: boolean;
        config?: ProviderCustomConfig;
        error?: string;
      }>;
      getAllProviderCustomConfigs?: () => Promise<{
        success: boolean;
        configs?: ProviderCustomConfigs;
        error?: string;
      }>;
      updateProviderCustomConfig?: (
        providerId: string,
        config: ProviderCustomConfig | undefined
      ) => Promise<{
        success: boolean;
        error?: string;
      }>;

      // Database operations
      getProjects: () => Promise<any[]>;
      saveProject: (project: any) => Promise<{ success: boolean; error?: string }>;
      getTasks: (projectId?: string) => Promise<any[]>;
      saveTask: (task: any) => Promise<{ success: boolean; error?: string }>;
      deleteProject: (projectId: string) => Promise<{ success: boolean; error?: string }>;
      deleteTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
      archiveTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
      restoreTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
      getArchivedTasks: (projectId?: string) => Promise<any[]>;

      // Conversation and Message operations
      saveConversation: (conversation: any) => Promise<{ success: boolean; error?: string }>;
      getConversations: (
        taskId: string
      ) => Promise<{ success: boolean; conversations?: any[]; error?: string }>;
      deleteConversation: (conversationId: string) => Promise<{ success: boolean; error?: string }>;
      cleanupSessionDirectory: (args: {
        taskPath: string;
        conversationId: string;
      }) => Promise<{ success: boolean }>;
      saveMessage: (message: any) => Promise<{ success: boolean; error?: string }>;
      getMessages: (
        conversationId: string
      ) => Promise<{ success: boolean; messages?: any[]; error?: string }>;
      getOrCreateDefaultConversation: (
        taskId: string
      ) => Promise<{ success: boolean; conversation?: any; error?: string }>;

      // Multi-chat support
      createConversation: (params: {
        taskId: string;
        title: string;
        provider?: string;
        isMain?: boolean;
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

      // Debug helpers
      debugAppendLog: (
        filePath: string,
        content: string,
        options?: { reset?: boolean }
      ) => Promise<{ success: boolean; error?: string }>;

      // Line comments
      lineCommentsGet: (args: { taskId: string; filePath?: string }) => Promise<{
        success: boolean;
        comments?: LineComment[];
        error?: string;
      }>;
      lineCommentsCreate: (args: {
        taskId: string;
        filePath: string;
        lineNumber: number;
        lineContent?: string;
        content: string;
      }) => Promise<{
        success: boolean;
        id?: string;
        error?: string;
      }>;
      lineCommentsUpdate: (args: { id: string; content: string }) => Promise<{
        success: boolean;
        error?: string;
      }>;
      lineCommentsDelete: (id: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
      lineCommentsGetFormatted: (taskId: string) => Promise<{
        success: boolean;
        formatted?: string;
        error?: string;
      }>;
      lineCommentsMarkSent: (commentIds: string[]) => Promise<{
        success: boolean;
        error?: string;
      }>;
      lineCommentsGetUnsent: (taskId: string) => Promise<{
        success: boolean;
        comments?: LineComment[];
        error?: string;
      }>;

      // SSH operations
      sshTestConnection: (config: {
        id?: string;
        name: string;
        host: string;
        port: number;
        username: string;
        authType: 'password' | 'key' | 'agent';
        privateKeyPath?: string;
        useAgent?: boolean;
        password?: string;
        passphrase?: string;
      }) => Promise<{ success: boolean; error?: string; latency?: number; debugLogs?: string[] }>;
      sshSaveConnection: (config: {
        id?: string;
        name: string;
        host: string;
        port: number;
        username: string;
        authType: 'password' | 'key' | 'agent';
        privateKeyPath?: string;
        useAgent?: boolean;
        password?: string;
        passphrase?: string;
      }) => Promise<{
        id: string;
        name: string;
        host: string;
        port: number;
        username: string;
        authType: 'password' | 'key' | 'agent';
        privateKeyPath?: string;
        useAgent?: boolean;
      }>;
      sshGetConnections: () => Promise<
        Array<{
          id: string;
          name: string;
          host: string;
          port: number;
          username: string;
          authType: 'password' | 'key' | 'agent';
          privateKeyPath?: string;
          useAgent?: boolean;
        }>
      >;
      sshDeleteConnection: (id: string) => Promise<void>;
      sshConnect: (
        arg:
          | string
          | {
              id?: string;
              name: string;
              host: string;
              port: number;
              username: string;
              authType: 'password' | 'key' | 'agent';
              privateKeyPath?: string;
              useAgent?: boolean;
              password?: string;
              passphrase?: string;
            }
      ) => Promise<string>;
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
      sshListFiles: (
        connectionId: string,
        path: string
      ) => Promise<
        Array<{
          path: string;
          name: string;
          type: 'file' | 'directory' | 'symlink';
          size: number;
          modifiedAt: Date;
          permissions?: string;
        }>
      >;
      sshReadFile: (connectionId: string, path: string) => Promise<string>;
      sshWriteFile: (connectionId: string, path: string, content: string) => Promise<void>;
      sshGetState: (
        connectionId: string
      ) => Promise<'connecting' | 'connected' | 'disconnected' | 'error'>;
      sshGetConfig: () => Promise<{ success: boolean; hosts?: any[]; error?: string }>;
      sshGetSshConfigHost: (hostAlias: string) => Promise<{
        success: boolean;
        host?: {
          host: string;
          hostname?: string;
          user?: string;
          port?: number;
          identityFile?: string;
        };
        error?: string;
      }>;
      sshCheckIsGitRepo: (connectionId: string, remotePath: string) => Promise<boolean>;
      sshInitRepo: (connectionId: string, parentPath: string, repoName: string) => Promise<string>;
      sshCloneRepo: (connectionId: string, repoUrl: string, targetPath: string) => Promise<string>;

      // Skills management
      skillsGetCatalog: () => Promise<{
        success: boolean;
        data?: import('@shared/skills/types').CatalogIndex;
        error?: string;
      }>;
      skillsRefreshCatalog: () => Promise<{
        success: boolean;
        data?: import('@shared/skills/types').CatalogIndex;
        error?: string;
      }>;
      skillsInstall: (args: { skillId: string }) => Promise<{
        success: boolean;
        data?: import('@shared/skills/types').CatalogSkill;
        error?: string;
      }>;
      skillsUninstall: (args: { skillId: string }) => Promise<{
        success: boolean;
        error?: string;
      }>;
      skillsGetDetail: (args: { skillId: string }) => Promise<{
        success: boolean;
        data?: import('@shared/skills/types').CatalogSkill;
        error?: string;
      }>;
      skillsGetDetectedAgents: () => Promise<{
        success: boolean;
        data?: import('@shared/skills/types').DetectedAgent[];
        error?: string;
      }>;
      skillsCreate: (args: { name: string; description: string; content?: string }) => Promise<{
        success: boolean;
        data?: import('@shared/skills/types').CatalogSkill;
        error?: string;
      }>;
    };
  }
}

// Explicit type export for better TypeScript recognition
export interface ElectronAPI {
  // Menu events (main → renderer)
  onMenuOpenSettings: (listener: () => void) => () => void;
  onMenuCheckForUpdates: (listener: () => void) => () => void;
  onMenuUndo: (listener: () => void) => () => void;
  onMenuRedo: (listener: () => void) => () => void;

  // App info
  getVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  listInstalledFonts: (args?: {
    refresh?: boolean;
  }) => Promise<{ success: boolean; fonts?: string[]; cached?: boolean; error?: string }>;
  undo: () => Promise<{ success: boolean; error?: string }>;
  redo: () => Promise<{ success: boolean; error?: string }>;
  // Updater
  checkForUpdates: () => Promise<{ success: boolean; result?: any; error?: string }>;
  downloadUpdate: () => Promise<{ success: boolean; error?: string }>;
  quitAndInstallUpdate: () => Promise<{ success: boolean; error?: string }>;
  openLatestDownload: () => Promise<{ success: boolean; error?: string }>;
  onUpdateEvent: (listener: (data: { type: string; payload?: any }) => void) => () => void;
  // Enhanced update methods
  getUpdateState: () => Promise<{ success: boolean; data?: any; error?: string }>;
  getUpdateSettings: () => Promise<{ success: boolean; data?: any; error?: string }>;
  updateUpdateSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;
  getReleaseNotes: () => Promise<{ success: boolean; data?: string | null; error?: string }>;
  checkForUpdatesNow: () => Promise<{ success: boolean; data?: any; error?: string }>;

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
  ptyStartDirect: (opts: {
    id: string;
    providerId: string;
    cwd: string;
    cols?: number;
    rows?: number;
    autoApprove?: boolean;
    initialPrompt?: string;
    env?: Record<string, string>;
    resume?: boolean;
  }) => Promise<{ ok: boolean; reused?: boolean; error?: string }>;
  ptyScpToRemote: (args: { connectionId: string; localPaths: string[] }) => Promise<{
    success: boolean;
    remotePaths?: string[];
    error?: string;
  }>;
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
  onAgentEvent: (
    listener: (event: AgentEvent, meta: { appFocused: boolean }) => void
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
  worktreeGetAll: () => Promise<{
    success: boolean;
    worktrees?: any[];
    error?: string;
  }>;

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
    projectPath?: string;
    isRemote?: boolean;
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
    taskName?: string;
  }) => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
  lifecycleRunStart: (args: {
    taskId: string;
    taskPath: string;
    projectPath: string;
    taskName?: string;
  }) => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
  lifecycleRunStop: (args: {
    taskId: string;
  }) => Promise<{ success: boolean; skipped?: boolean; error?: string }>;
  lifecycleTeardown: (args: {
    taskId: string;
    taskPath: string;
    projectPath: string;
    taskName?: string;
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
  mergeToMain: (args: { taskPath: string }) => Promise<{
    success: boolean;
    output?: string;
    prUrl?: string;
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
  fsSearchContent: (
    root: string,
    query: string,
    options?: {
      caseSensitive?: boolean;
      maxResults?: number;
      fileExtensions?: string[];
    },
    remote?: { connectionId: string; remotePath: string }
  ) => Promise<{
    success: boolean;
    results?: Array<{
      file: string;
      matches: Array<{
        line: number;
        column: number;
        text: string;
        preview: string;
      }>;
    }>;
    error?: string;
  }>;

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
  archiveTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
  restoreTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
  getArchivedTasks: (projectId?: string) => Promise<any[]>;

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

  // Line comments
  lineCommentsGet: (args: { taskId: string; filePath?: string }) => Promise<{
    success: boolean;
    comments?: LineComment[];
    error?: string;
  }>;
  lineCommentsCreate: (args: {
    taskId: string;
    filePath: string;
    lineNumber: number;
    lineContent?: string;
    content: string;
  }) => Promise<{
    success: boolean;
    id?: string;
    error?: string;
  }>;
  lineCommentsUpdate: (args: { id: string; content: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  lineCommentsDelete: (id: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  lineCommentsGetFormatted: (taskId: string) => Promise<{
    success: boolean;
    formatted?: string;
    error?: string;
  }>;
  lineCommentsMarkSent: (commentIds: string[]) => Promise<{
    success: boolean;
    error?: string;
  }>;
  lineCommentsGetUnsent: (taskId: string) => Promise<{
    success: boolean;
    comments?: LineComment[];
    error?: string;
  }>;

  // Skills management
  skillsGetCatalog: () => Promise<{
    success: boolean;
    data?: import('@shared/skills/types').CatalogIndex;
    error?: string;
  }>;
  skillsRefreshCatalog: () => Promise<{
    success: boolean;
    data?: import('@shared/skills/types').CatalogIndex;
    error?: string;
  }>;
  skillsInstall: (args: { skillId: string }) => Promise<{
    success: boolean;
    data?: import('@shared/skills/types').CatalogSkill;
    error?: string;
  }>;
  skillsUninstall: (args: { skillId: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  skillsGetDetail: (args: { skillId: string }) => Promise<{
    success: boolean;
    data?: import('@shared/skills/types').CatalogSkill;
    error?: string;
  }>;
  skillsGetDetectedAgents: () => Promise<{
    success: boolean;
    data?: import('@shared/skills/types').DetectedAgent[];
    error?: string;
  }>;
  skillsCreate: (args: { name: string; description: string }) => Promise<{
    success: boolean;
    data?: import('@shared/skills/types').CatalogSkill;
    error?: string;
  }>;
}
import type { TerminalSnapshotPayload } from '#types/terminalSnapshot';
import type { OpenInAppId } from '#shared/openInApps';
