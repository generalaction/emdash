import type { TerminalSnapshotPayload } from '#types/terminalSnapshot';

type ProjectSettingsPayload = {
  projectId: string;
  name: string;
  path: string;
  gitRemote?: string;
  gitBranch?: string;
  baseRef?: string;
};

// Global type declarations for Electron API
declare global {
  interface Window {
    electronAPI: {
      getVersion: () => Promise<string>;
      getPlatform: () => Promise<string>;
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
      ptyInput: (args: { id: string; data: string }) => void;
      ptyResize: (args: { id: string; cols: number; rows: number }) => void;
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
      onLifecycleEvent: (listener: (data: any) => void) => () => void;

      openProject: () => Promise<{ success: boolean; path?: string; error?: string }>;
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
      fetchProjectBaseRef: (args: { projectId: string; projectPath: string }) => Promise<{
        success: boolean;
        baseRef?: string;
        remote?: string;
        branch?: string;
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
      listRemoteBranches: (args: { projectPath: string; remote?: string }) => Promise<{
        success: boolean;
        branches?: Array<{ ref: string; remote: string; branch: string; label: string }>;
        error?: string;
      }>;
      connectToGitHub: (
        projectPath: string
      ) => Promise<{ success: boolean; repository?: string; branch?: string; error?: string }>;
      scanRepos: () => Promise<any[]>;
      addRepo: (path: string) => Promise<any>;
      // Filesystem
      fsList: (
        root: string,
        opts?: { includeDirs?: boolean; maxEntries?: number; timeBudgetMs?: number }
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
        maxBytes?: number
      ) => Promise<{
        success: boolean;
        path?: string;
        size?: number;
        truncated?: boolean;
        content?: string;
        error?: string;
      }>;
      githubAuth: () => Promise<{ success: boolean; token?: string; user?: any; error?: string }>;
      githubIsAuthenticated: () => Promise<boolean>;
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
      getSettings: () => Promise<any>;
      updateSettings: (settings: any) => Promise<void>;
      linearCheckConnection?: () => Promise<{
        connected: boolean;
        taskName?: string;
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
      // Database methods
      getDbDebugInfo: () => Promise<{
        success: boolean;
        appName?: string;
        userDataPath?: string;
        dbPath?: string;
        dbExists?: boolean;
        error?: string;
      }>;
      getProjects: () => Promise<any[]>;
      saveProject: (project: any) => Promise<{ success: boolean; error?: string }>;
      getTasks: (projectId?: string) => Promise<any[]>;
      saveTask: (task: any) => Promise<{ success: boolean; error?: string }>;
      deleteProject: (projectId: string) => Promise<{ success: boolean; error?: string }>;
      deleteTask: (taskId: string) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

export {};
