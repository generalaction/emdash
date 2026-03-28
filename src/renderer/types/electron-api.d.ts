// Updated for Codex integration

import type { AgentEvent } from '../../shared/agentEvents';
import type { AutoMergeRequest } from '../lib/prStatus';
import type { DiffPayload } from '../../shared/diff/types';
import type { GitIndexUpdateArgs } from '../../shared/git/types';
import type { ResourceMetricsSnapshot } from '../../shared/performanceTypes';

type ProjectSettingsPayload = {
  projectId: string;
  name: string;
  path: string;
  gitRemote?: string;
  gitBranch?: string;
  baseRef?: string;
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

      // Window controls (custom title bar on Windows/Linux)
      windowMinimize: () => Promise<void>;
      windowMaximize: () => Promise<void>;
      windowClose: () => Promise<void>;
      windowIsMaximized: () => Promise<boolean>;
      popupMenu: (args: { label: string; x: number; y: number }) => Promise<void>;
      onWindowMaximizeChange: (listener: (isMaximized: boolean) => void) => () => void;

      // Menu events (main → renderer)
      onMenuOpenSettings: (listener: () => void) => () => void;
      onMenuCheckForUpdates: (listener: () => void) => () => void;
      onMenuUndo: (listener: () => void) => () => void;
      onMenuRedo: (listener: () => void) => () => void;
      onMenuCloseTab: (listener: () => void) => () => void;

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
      }) => Promise<{ ok: boolean; tmux?: boolean; error?: string }>;
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
      }) => Promise<{ ok: boolean; reused?: boolean; tmux?: boolean; error?: string }>;
      ptyScpToRemote: (args: { connectionId: string; localPaths: string[] }) => Promise<{
        success: boolean;
        remotePaths?: string[];
        error?: string;
      }>;
      ptyInput: (args: { id: string; data: string }) => void;
      ptyResize: (args: { id: string; cols: number; rows?: number }) => void;
      ptyKill: (id: string) => void;
      ptyKillTmux: (id: string) => Promise<{ ok: boolean; error?: string }>;
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
      onPtyStarted: (listener: (data: { id: string }) => void) => () => void;
      onPtyActivity: (listener: (data: { id: string; chunk?: string }) => void) => () => void;
      onPtyExitGlobal: (listener: (data: { id: string }) => void) => () => void;
      onAgentEvent: (
        listener: (event: AgentEvent, meta: { appFocused: boolean }) => void
      ) => () => void;
      onNotificationFocusTask: (listener: (taskId: string) => void) => () => void;
      taskInferName: (args: {
        taskId: string;
        providerId: string;
        initialPrompt: string;
        projectPath: string;
      }) => Promise<{ accepted: boolean }>;
      onTaskNameInferred: (
        listener: (data: { taskId: string; name: string | null }) => void
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
        taskPath?: string;
        projectPath?: string;
        taskName?: string;
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
      lifecycleGetLogs: (args: { taskId: string }) => Promise<{
        success: boolean;
        logs?: { setup: string[]; run: string[]; teardown: string[] };
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
      openFile: (args?: {
        title?: string;
        message?: string;
        filters?: Electron.FileFilter[];
      }) => Promise<{
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
      getGitStatus: (arg: string | { taskPath: string; taskId?: string }) => Promise<{
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
      watchGitStatus: (arg: string | { taskPath: string; taskId?: string }) => Promise<{
        success: boolean;
        watchId?: string;
        error?: string;
      }>;
      unwatchGitStatus: (
        arg: string | { taskPath: string; taskId?: string },
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
        taskId?: string;
        filePath: string;
        baseRef?: string;
        forceLarge?: boolean;
      }) => Promise<{
        success: boolean;
        diff?: DiffPayload;
        error?: string;
      }>;
      updateIndex: (args: { taskPath: string; taskId?: string } & GitIndexUpdateArgs) => Promise<{
        success: boolean;
        error?: string;
      }>;
      revertFile: (args: { taskPath: string; taskId?: string; filePath: string }) => Promise<{
        success: boolean;
        action?: 'reverted';
        error?: string;
      }>;
      gitCommit: (args: { taskPath: string; message: string }) => Promise<{
        success: boolean;
        hash?: string;
        error?: string;
      }>;
      gitPush: (args: { taskPath: string }) => Promise<{
        success: boolean;
        output?: string;
        error?: string;
      }>;
      gitPull: (args: { taskPath: string }) => Promise<{
        success: boolean;
        output?: string;
        error?: string;
      }>;
      gitGetLog: (args: {
        taskPath: string;
        maxCount?: number;
        skip?: number;
        aheadCount?: number;
      }) => Promise<{
        success: boolean;
        commits?: Array<{
          hash: string;
          subject: string;
          body: string;
          author: string;
          authorEmail: string;
          date: string;
          isPushed: boolean;
          tags: string[];
        }>;
        aheadCount?: number;
        error?: string;
      }>;
      gitGetLatestCommit: (args: { taskPath: string }) => Promise<{
        success: boolean;
        commit?: {
          hash: string;
          subject: string;
          body: string;
          isPushed: boolean;
        } | null;
        error?: string;
      }>;
      gitGetCommitFiles: (args: { taskPath: string; commitHash: string }) => Promise<{
        success: boolean;
        files?: Array<{
          path: string;
          status: string;
          additions: number;
          deletions: number;
        }>;
        error?: string;
      }>;
      gitGetCommitFileDiff: (args: {
        taskPath: string;
        commitHash: string;
        filePath: string;
        forceLarge?: boolean;
      }) => Promise<{
        success: boolean;
        diff?: DiffPayload;
        error?: string;
      }>;
      gitSoftReset: (args: { taskPath: string }) => Promise<{
        success: boolean;
        subject?: string;
        body?: string;
        error?: string;
      }>;
      gitCommitAndPush: (args: {
        taskPath: string;
        taskId?: string;
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
      mergeToMain: (args: { taskPath: string; taskId?: string }) => Promise<{
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
          autoMergeRequest?: AutoMergeRequest | null;
        } | null;
        error?: string;
      }>;
      enableAutoMerge: (args: {
        taskPath: string;
        prNumber?: number;
        strategy?: 'merge' | 'squash' | 'rebase';
      }) => Promise<{
        success: boolean;
        output?: string;
        error?: string;
      }>;
      disableAutoMerge: (args: { taskPath: string; prNumber?: number }) => Promise<{
        success: boolean;
        output?: string;
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
      getBranchStatus: (args: { taskPath: string; taskId?: string }) => Promise<{
        success: boolean;
        branch?: string;
        defaultBranch?: string;
        ahead?: number;
        behind?: number;
        aheadOfDefault?: number;
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
          posthogKey?: string;
          posthogHost?: string;
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
          posthogKey?: string;
          posthogHost?: string;
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

      fsRename: (
        root: string,
        oldName: string,
        newName: string,
        remote?: { connectionId: string; remotePath: string }
      ) => Promise<{ success: boolean; error?: string }>;
      fsMkdir: (
        root: string,
        relPath: string,
        remote?: { connectionId: string; remotePath: string }
      ) => Promise<{ success: boolean; error?: string }>;
      fsRmdir: (
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
      ensureGitignore: (
        projectPath: string,
        patterns: string[]
      ) => Promise<{ success: boolean; error?: string }>;
      // Attachments
      saveAttachment: (args: { taskPath: string; srcPath: string; subdir?: string }) => Promise<{
        success: boolean;
        absPath?: string;
        relPath?: string;
        fileName?: string;
        error?: string;
      }>;

      // Emdash Account
      accountGetSession: () => Promise<{
        success: boolean;
        data?: {
          user: { userId: string; username: string; avatarUrl: string; email: string } | null;
          isSignedIn: boolean;
          hasAccount: boolean;
        };
        error?: string;
      }>;
      accountSignIn: () => Promise<{
        success: boolean;
        data?: { user: { userId: string; username: string; avatarUrl: string; email: string } };
        error?: string;
      }>;
      accountSignOut: () => Promise<{ success: boolean; error?: string }>;
      accountCheckServerHealth: () => Promise<{
        success: boolean;
        data?: { available: boolean };
      }>;
      accountValidateSession: () => Promise<{
        success: boolean;
        data?: { valid: boolean };
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
      githubAuthOAuth: () => Promise<{
        success: boolean;
        token?: string;
        user?: any;
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
      githubListPullRequests: (args: {
        projectPath: string;
        limit?: number;
        searchQuery?: string;
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
      // GitLab
      gitlabSaveCredentials?: (args: {
        instanceUrl: string;
        token: string;
      }) => Promise<{ success: boolean; displayName?: string; error?: string }>;
      gitlabClearCredentials?: () => Promise<{ success: boolean; error?: string }>;
      gitlabCheckConnection?: () => Promise<{
        success: boolean;
        username?: string;
        instanceUrl?: string;
        error?: string;
      }>;
      gitlabInitialFetch?: (
        projectPath: string,
        limit?: number
      ) => Promise<{ success: boolean; issues?: any[]; error?: string }>;
      gitlabSearchIssues?: (
        projectPath: string,
        searchTerm: string,
        limit?: number
      ) => Promise<{ success: boolean; issues?: any[]; error?: string }>;
      // Plain integration
      plainSaveToken?: (token: string) => Promise<{
        success: boolean;
        workspaceName?: string;
        error?: string;
      }>;
      plainCheckConnection?: () => Promise<{
        connected: boolean;
        workspaceName?: string;
        error?: string;
      }>;
      plainClearToken?: () => Promise<{
        success: boolean;
        error?: string;
      }>;
      plainInitialFetch?: (
        limit?: number,
        statuses?: string[]
      ) => Promise<{
        success: boolean;
        threads?: any[];
        error?: string;
      }>;
      plainSearchThreads?: (
        searchTerm: string,
        limit?: number
      ) => Promise<{
        success: boolean;
        threads?: any[];
        error?: string;
      }>;
      // Forgejo
      forgejoSaveCredentials?: (args: {
        instanceUrl: string;
        token: string;
      }) => Promise<{ success: boolean; error?: string }>;
      forgejoClearCredentials?: () => Promise<{ success: boolean; error?: string }>;
      forgejoCheckConnection?: () => Promise<{
        success: boolean;
        error?: string;
      }>;
      forgejoInitialFetch?: (
        projectPath: string,
        limit?: number
      ) => Promise<{ success: boolean; issues?: any[]; error?: string }>;
      forgejoSearchIssues?: (
        projectPath: string,
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

      // Debug helpers
      debugAppendLog: (
        filePath: string,
        content: string,
        options?: { reset?: boolean }
      ) => Promise<{ success: boolean; error?: string }>;

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
      skillsInstall: (args: {
        skillId: string;
        source?: { owner: string; repo: string };
      }) => Promise<{
        success: boolean;
        data?: import('@shared/skills/types').CatalogSkill;
        error?: string;
      }>;
      skillsUninstall: (args: { skillId: string }) => Promise<{
        success: boolean;
        error?: string;
      }>;
      skillsGetDetail: (args: {
        skillId: string;
        source?: { owner: string; repo: string };
      }) => Promise<{
        success: boolean;
        data?: import('@shared/skills/types').CatalogSkill;
        error?: string;
      }>;
      skillsGetDetectedAgents: () => Promise<{
        success: boolean;
        data?: import('@shared/skills/types').DetectedAgent[];
        error?: string;
      }>;
      skillsSearch: (args: { query: string }) => Promise<{
        success: boolean;
        data?: import('@shared/skills/types').CatalogSkill[];
        error?: string;
      }>;
      skillsCreate: (args: { name: string; description: string; content?: string }) => Promise<{
        success: boolean;
        data?: import('@shared/skills/types').CatalogSkill;
        error?: string;
      }>;

      // Workspace provisioning
      workspaceProvision: (args: {
        taskId: string;
        repoUrl: string;
        branch: string;
        baseRef: string;
        provisionCommand: string;
        projectPath: string;
      }) => Promise<{ success: boolean; data?: { instanceId: string }; error?: string }>;
      workspaceCancel: (args: {
        instanceId: string;
      }) => Promise<{ success: boolean; error?: string }>;
      workspaceTerminate: (args: {
        instanceId: string;
        terminateCommand: string;
        projectPath: string;
        env?: Record<string, string>;
      }) => Promise<{ success: boolean; error?: string }>;
      workspaceStatus: (args: { taskId: string }) => Promise<{
        success: boolean;
        data?: {
          id: string;
          taskId: string;
          externalId: string | null;
          host: string;
          port: number;
          username: string | null;
          worktreePath: string | null;
          status: string;
          connectionId: string | null;
          createdAt: number;
          terminatedAt: number | null;
        } | null;
        error?: string;
      }>;
      onWorkspaceProvisionProgress: (
        listener: (data: { instanceId: string; line: string }) => void
      ) => () => void;
      onWorkspaceProvisionTimeoutWarning: (
        listener: (data: { instanceId: string; timeoutMs: number }) => void
      ) => () => void;
      onWorkspaceProvisionComplete: (
        listener: (data: { instanceId: string; status: string; error?: string }) => void
      ) => () => void;

      // MCP
      mcpLoadAll: () => Promise<{
        success: boolean;
        data?: import('../../shared/mcp/types').McpLoadAllResponse;
        error?: string;
      }>;
      mcpSaveServer: (server: import('../../shared/mcp/types').McpServer) => Promise<{
        success: boolean;
        error?: string;
      }>;
      mcpRemoveServer: (serverName: string) => Promise<{
        success: boolean;
        error?: string;
      }>;
      mcpGetProviders: () => Promise<{
        success: boolean;
        data?: import('../../shared/mcp/types').McpProvidersResponse[];
        error?: string;
      }>;
      mcpRefreshProviders: () => Promise<{
        success: boolean;
        data?: import('../../shared/mcp/types').McpProvidersResponse[];
        error?: string;
      }>;

      // Performance Monitor
      perfSubscribe: () => Promise<{
        success: boolean;
        data?: ResourceMetricsSnapshot;
      }>;
      perfUnsubscribe: () => Promise<{ success: boolean }>;
      perfGetSnapshot: (mode?: 'interactive' | 'idle') => Promise<{
        success: boolean;
        data?: ResourceMetricsSnapshot;
        error?: string;
      }>;
      onPerfSnapshot: (listener: (snapshot: ResourceMetricsSnapshot) => void) => () => void;
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
  onMenuCloseTab: (listener: () => void) => () => void;

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
  }) => Promise<{ ok: boolean; tmux?: boolean; error?: string }>;
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
  }) => Promise<{ ok: boolean; reused?: boolean; tmux?: boolean; error?: string }>;
  ptyScpToRemote: (args: { connectionId: string; localPaths: string[] }) => Promise<{
    success: boolean;
    remotePaths?: string[];
    error?: string;
  }>;
  ptyInput: (args: { id: string; data: string }) => void;
  ptyResize: (args: { id: string; cols: number; rows?: number }) => void;
  ptyKill: (id: string) => void;
  ptyKillTmux: (id: string) => Promise<{ ok: boolean; error?: string }>;
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
  onPtyStarted: (listener: (data: { id: string }) => void) => () => void;
  onPtyActivity: (listener: (data: { id: string; chunk?: string }) => void) => () => void;
  onPtyExitGlobal: (listener: (data: { id: string }) => void) => () => void;
  onAgentEvent: (
    listener: (event: AgentEvent, meta: { appFocused: boolean }) => void
  ) => () => void;
  onNotificationFocusTask: (listener: (taskId: string) => void) => () => void;
  taskInferName: (args: {
    taskId: string;
    providerId: string;
    initialPrompt: string;
    projectPath: string;
  }) => Promise<{ accepted: boolean }>;
  onTaskNameInferred: (
    listener: (data: { taskId: string; name: string | null }) => void
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
    taskPath?: string;
    projectPath?: string;
    taskName?: string;
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
  lifecycleGetLogs: (args: { taskId: string }) => Promise<{
    success: boolean;
    logs?: { setup: string[]; run: string[]; teardown: string[] };
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
  openFile: (args?: {
    title?: string;
    message?: string;
    filters?: Electron.FileFilter[];
  }) => Promise<{
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
  mergeToMain: (args: { taskPath: string; taskId?: string }) => Promise<{
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
  githubListPullRequests: (args: {
    projectPath: string;
    limit?: number;
    searchQuery?: string;
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

  // Plain integration
  plainSaveToken?: (token: string) => Promise<{
    success: boolean;
    workspaceName?: string;
    error?: string;
  }>;
  plainCheckConnection?: () => Promise<{
    connected: boolean;
    workspaceName?: string;
    error?: string;
  }>;
  plainClearToken?: () => Promise<{
    success: boolean;
    error?: string;
  }>;
  plainInitialFetch?: (
    limit?: number,
    statuses?: string[]
  ) => Promise<{
    success: boolean;
    threads?: any[];
    error?: string;
  }>;
  plainSearchThreads?: (
    searchTerm: string,
    limit?: number
  ) => Promise<{
    success: boolean;
    threads?: any[];
    error?: string;
  }>;

  // Debug helpers
  debugAppendLog: (
    filePath: string,
    content: string,
    options?: { reset?: boolean }
  ) => Promise<{ success: boolean; error?: string }>;

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
  skillsInstall: (args: { skillId: string; source?: { owner: string; repo: string } }) => Promise<{
    success: boolean;
    data?: import('@shared/skills/types').CatalogSkill;
    error?: string;
  }>;
  skillsUninstall: (args: { skillId: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  skillsGetDetail: (args: {
    skillId: string;
    source?: { owner: string; repo: string };
  }) => Promise<{
    success: boolean;
    data?: import('@shared/skills/types').CatalogSkill;
    error?: string;
  }>;
  skillsGetDetectedAgents: () => Promise<{
    success: boolean;
    data?: import('@shared/skills/types').DetectedAgent[];
    error?: string;
  }>;
  skillsSearch: (args: { query: string }) => Promise<{
    success: boolean;
    data?: import('@shared/skills/types').CatalogSkill[];
    error?: string;
  }>;
  skillsCreate: (args: { name: string; description: string }) => Promise<{
    success: boolean;
    data?: import('@shared/skills/types').CatalogSkill;
    error?: string;
  }>;

  // Workspace provisioning
  workspaceProvision: (args: {
    taskId: string;
    repoUrl: string;
    branch: string;
    baseRef: string;
    provisionCommand: string;
    projectPath: string;
  }) => Promise<{ success: boolean; data?: { instanceId: string }; error?: string }>;
  workspaceCancel: (args: { instanceId: string }) => Promise<{ success: boolean; error?: string }>;
  workspaceTerminate: (args: {
    instanceId: string;
    terminateCommand: string;
    projectPath: string;
    env?: Record<string, string>;
  }) => Promise<{ success: boolean; error?: string }>;
  workspaceStatus: (args: { taskId: string }) => Promise<{
    success: boolean;
    data?: {
      id: string;
      taskId: string;
      externalId: string | null;
      host: string;
      port: number;
      username: string | null;
      worktreePath: string | null;
      status: string;
      connectionId: string | null;
      createdAt: number;
      terminatedAt: number | null;
    } | null;
    error?: string;
  }>;
  onWorkspaceProvisionProgress: (
    listener: (data: { instanceId: string; line: string }) => void
  ) => () => void;
  onWorkspaceProvisionTimeoutWarning: (
    listener: (data: { instanceId: string; timeoutMs: number }) => void
  ) => () => void;
  onWorkspaceProvisionComplete: (
    listener: (data: { instanceId: string; status: string; error?: string }) => void
  ) => () => void;

  // MCP
  mcpLoadAll: () => Promise<{
    success: boolean;
    data?: import('../../shared/mcp/types').McpLoadAllResponse;
    error?: string;
  }>;
  mcpSaveServer: (server: import('../../shared/mcp/types').McpServer) => Promise<{
    success: boolean;
    error?: string;
  }>;
  mcpRemoveServer: (serverName: string) => Promise<{
    success: boolean;
    error?: string;
  }>;
  mcpGetProviders: () => Promise<{
    success: boolean;
    data?: import('../../shared/mcp/types').McpProvidersResponse[];
    error?: string;
  }>;
  mcpRefreshProviders: () => Promise<{
    success: boolean;
    data?: import('../../shared/mcp/types').McpProvidersResponse[];
    error?: string;
  }>;

  // Performance Monitor
  perfSubscribe: () => Promise<{
    success: boolean;
    data?: ResourceMetricsSnapshot;
  }>;
  perfUnsubscribe: () => Promise<{ success: boolean }>;
  perfGetSnapshot: (mode?: 'interactive' | 'idle') => Promise<{
    success: boolean;
    data?: ResourceMetricsSnapshot;
    error?: string;
  }>;
  onPerfSnapshot: (listener: (snapshot: ResourceMetricsSnapshot) => void) => () => void;
}
import type { TerminalSnapshotPayload } from '#types/terminalSnapshot';
import type { OpenInAppId } from '#shared/openInApps';
