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
        sshConfig?: {
          host: string;
          user: string;
          remotePath: string;
          port?: number;
          keyPath?: string;
        };
      }) => Promise<{ ok: boolean }>;
      ptyInput: (args: { id: string; data: string }) => void;
      ptyResize: (args: { id: string; cols: number; rows: number }) => void;
      ptyKill: (id: string) => void;
      onPtyData: (id: string, listener: (data: string) => void) => () => void;
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
      openProject: () => Promise<{ success: boolean; path?: string; error?: string }>;
      getGitInfo: (projectPath: string) => Promise<{
        isGitRepo: boolean;
        remote?: string;
        branch?: string;
        path?: string;
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
      connectToGitHub: (
        projectPath: string
      ) => Promise<{ success: boolean; repository?: string; branch?: string; error?: string }>;
      scanRepos: () => Promise<any[]>;
      addRepo: (path: string) => Promise<any>;
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
      createRun: (config: any) => Promise<string>;
      cancelRun: (runId: string) => Promise<void>;
      getRunDiff: (runId: string) => Promise<any>;
      onRunEvent: (callback: (event: any) => void) => void;
      removeRunEventListeners: () => void;
      githubAuth: () => Promise<{ success: boolean; token?: string; user?: any; error?: string }>;
      githubIsAuthenticated: () => Promise<boolean>;
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
      getSettings: () => Promise<any>;
      updateSettings: (settings: any) => Promise<void>;
      linearCheckConnection?: () => Promise<{
        connected: boolean;
        workspaceName?: string;
      }>;
      linearSaveToken?: (token: string) => Promise<{
        success: boolean;
        workspaceName?: string;
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
      // Floating window
      floatingToggle?: () => Promise<{ success: boolean; error?: string }>;
      floatingSetWorkspace?: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;
      floatingGetWorkspace?: () => Promise<{
        success: boolean;
        workspaceId?: string | null;
        error?: string;
      }>;
      floatingShow?: () => Promise<{ success: boolean; error?: string }>;
      onFloatingWorkspaceChanged?: (listener: (workspaceId: string) => void) => () => void;
      // Database methods
      getProjects: () => Promise<any[]>;
      saveProject: (project: any) => Promise<{ success: boolean; error?: string }>;
      getWorkspaces: (projectId?: string) => Promise<any[]>;
      saveWorkspace: (workspace: any) => Promise<{ success: boolean; error?: string }>;
      deleteProject: (projectId: string) => Promise<{ success: boolean; error?: string }>;
      deleteWorkspace: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

export {};
