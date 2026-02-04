// Updated for Codex integration
export {};

declare global {
  interface Window {
    electronAPI: {
      // App info
      getVersion: () => Promise<string>;
      getPlatform: () => Promise<string>;

      // PTY
      ptyStart: (opts: {
        id: string;
        cwd?: string;
        shell?: string;
        env?: Record<string, string>;
        cols?: number;
        rows?: number;
      }) => Promise<{ ok: boolean }>;
      ptyInput: (args: { id: string; data: string }) => void;
      ptyResize: (args: { id: string; cols: number; rows?: number }) => void;
      ptyKill: (id: string) => void;
      onPtyData: (id: string, listener: (data: string) => void) => () => void;
      onPtyExit: (
        id: string,
        listener: (info: { exitCode: number; signal?: number }) => void,
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
      getGitInfo: (
        projectPath: string,
      ) => Promise<{
        isGitRepo: boolean;
        remote?: string;
        branch?: string;
        path?: string;
        error?: string;
      }>;
      getGitStatus: (
        workspacePath: string,
      ) => Promise<{
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
      getFileDiff: (args: {
        workspacePath: string;
        filePath: string;
      }) => Promise<{
        success: boolean;
        diff?: {
          lines: Array<{
            left?: string;
            right?: string;
            type: "context" | "add" | "del";
          }>;
        };
        error?: string;
      }>;
      gitCommitAndPush: (args: {
        workspacePath: string;
        commitMessage?: string;
        createBranchIfOnDefault?: boolean;
        branchPrefix?: string;
      }) => Promise<{
        success: boolean;
        branch?: string;
        output?: string;
        error?: string;
      }>;
      createPullRequest: (args: {
        workspacePath: string;
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
      getPrStatus: (args: {
        workspacePath: string;
      }) => Promise<{
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
        } | null;
        error?: string;
      }>;
      openExternal: (
        url: string,
      ) => Promise<{ success: boolean; error?: string }>;
      connectToGitHub: (
        projectPath: string,
      ) => Promise<{
        success: boolean;
        repository?: string;
        branch?: string;
        error?: string;
      }>;

      // Filesystem helpers
      fsList: (
        root: string,
        opts?: {
          includeDirs?: boolean;
          maxEntries?: number;
          timeBudgetMs?: number;
        },
      ) => Promise<{
        success: boolean;
        items?: Array<{ path: string; type: "file" | "dir" }>;
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
      ) => Promise<{
        success: boolean;
        path?: string;
        size?: number;
        truncated?: boolean;
        content?: string;
        error?: string;
      }>;

      // Run events
      onRunEvent: (callback: (event: any) => void) => void;
      removeRunEventListeners: () => void;

      // GitHub integration
      githubAuth: () => Promise<{
        success: boolean;
        token?: string;
        user?: any;
        error?: string;
      }>;
      githubIsAuthenticated: () => Promise<boolean>;
      githubGetStatus: () => Promise<{
        installed: boolean;
        authenticated: boolean;
        user?: any;
      }>;
      githubGetUser: () => Promise<any>;
      githubGetRepositories: () => Promise<any[]>;
      githubLogout: () => Promise<void>;

      // Database operations
      getProjects: () => Promise<any[]>;
      saveProject: (
        project: any,
      ) => Promise<{ success: boolean; error?: string }>;
      getWorkspaces: (projectId?: string) => Promise<any[]>;
      saveWorkspace: (
        workspace: any,
      ) => Promise<{ success: boolean; error?: string }>;
      deleteProject: (
        projectId: string,
      ) => Promise<{ success: boolean; error?: string }>;
      deleteWorkspace: (
        workspaceId: string,
      ) => Promise<{ success: boolean; error?: string }>;

      // Message operations
      saveMessage: (
        message: any,
      ) => Promise<{ success: boolean; error?: string }>;
      getMessages: (
        conversationId: string,
      ) => Promise<{ success: boolean; messages?: any[]; error?: string }>;
      getOrCreateDefaultConversation: (
        workspaceId: string,
      ) => Promise<{ success: boolean; conversation?: any; error?: string }>;

      // Debug helpers
      debugAppendLog: (
        filePath: string,
        content: string,
        options?: { reset?: boolean },
      ) => Promise<{ success: boolean; error?: string }>;

      // Codex
      codexCheckInstallation: () => Promise<{
        success: boolean;
        isInstalled?: boolean;
        error?: string;
      }>;
      codexCreateAgent: (
        workspaceId: string,
        worktreePath: string,
      ) => Promise<{ success: boolean; agent?: any; error?: string }>;
      codexSendMessage: (
        workspaceId: string,
        message: string,
      ) => Promise<{ success: boolean; response?: any; error?: string }>;
      codexSendMessageStream: (
        workspaceId: string,
        message: string,
      ) => Promise<{ success: boolean; error?: string }>;
      codexStopStream: (
        workspaceId: string,
      ) => Promise<{ success: boolean; stopped?: boolean; error?: string }>;
      codexGetAgentStatus: (
        workspaceId: string,
      ) => Promise<{ success: boolean; agent?: any; error?: string }>;
      codexGetAllAgents: () => Promise<{
        success: boolean;
        agents?: any[];
        error?: string;
      }>;
      codexRemoveAgent: (
        workspaceId: string,
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
        }) => void,
      ) => () => void;
      onCodexStreamError: (
        listener: (data: {
          workspaceId: string;
          error: string;
          agentId: string;
        }) => void,
      ) => () => void;
      onCodexStreamComplete: (
        listener: (data: {
          workspaceId: string;
          exitCode: number;
          agentId: string;
        }) => void,
      ) => () => void;
    };
  }
}

// Explicit type export for better TypeScript recognition
export interface ElectronAPI {
  // App info
  getVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;

  // PTY
  ptyStart: (opts: {
    id: string;
    cwd?: string;
    shell?: string;
    env?: Record<string, string>;
    cols?: number;
    rows?: number;
  }) => Promise<{ ok: boolean }>;
  ptyInput: (args: { id: string; data: string }) => void;
  ptyResize: (args: { id: string; cols: number; rows?: number }) => void;
  ptyKill: (id: string) => void;
  onPtyData: (id: string, listener: (data: string) => void) => () => void;
  onPtyExit: (
    id: string,
    listener: (info: { exitCode: number; signal?: number }) => void,
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
  getGitInfo: (
    projectPath: string,
  ) => Promise<{
    isGitRepo: boolean;
    remote?: string;
    branch?: string;
    path?: string;
    error?: string;
  }>;
  createPullRequest: (args: {
    workspacePath: string;
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
  connectToGitHub: (
    projectPath: string,
  ) => Promise<{
    success: boolean;
    repository?: string;
    branch?: string;
    error?: string;
  }>;

  // Filesystem
  fsList: (
    root: string,
    opts?: {
      includeDirs?: boolean;
      maxEntries?: number;
      timeBudgetMs?: number;
    },
  ) => Promise<{
    success: boolean;
    items?: Array<{ path: string; type: "file" | "dir" }>;
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
  ) => Promise<{
    success: boolean;
    path?: string;
    size?: number;
    truncated?: boolean;
    content?: string;
    error?: string;
  }>;

  // Run events
  onRunEvent: (callback: (event: any) => void) => void;
  removeRunEventListeners: () => void;

  // GitHub integration
  githubAuth: () => Promise<{
    success: boolean;
    token?: string;
    user?: any;
    error?: string;
  }>;
  githubIsAuthenticated: () => Promise<boolean>;
  githubGetUser: () => Promise<any>;
  githubGetRepositories: () => Promise<any[]>;
  githubLogout: () => Promise<void>;

  // Database operations
  getProjects: () => Promise<any[]>;
  saveProject: (project: any) => Promise<{ success: boolean; error?: string }>;
  getWorkspaces: (projectId?: string) => Promise<any[]>;
  saveWorkspace: (
    workspace: any,
  ) => Promise<{ success: boolean; error?: string }>;
  deleteProject: (
    projectId: string,
  ) => Promise<{ success: boolean; error?: string }>;
  deleteWorkspace: (
    workspaceId: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Message operations
  saveMessage: (message: any) => Promise<{ success: boolean; error?: string }>;
  getMessages: (
    conversationId: string,
  ) => Promise<{ success: boolean; messages?: any[]; error?: string }>;
  getOrCreateDefaultConversation: (
    workspaceId: string,
  ) => Promise<{ success: boolean; conversation?: any; error?: string }>;

  // Debug helpers
  debugAppendLog: (
    filePath: string,
    content: string,
    options?: { reset?: boolean },
  ) => Promise<{ success: boolean; error?: string }>;

  // Codex
  codexCheckInstallation: () => Promise<{
    success: boolean;
    isInstalled?: boolean;
    error?: string;
  }>;
  codexCreateAgent: (
    workspaceId: string,
    worktreePath: string,
  ) => Promise<{ success: boolean; agent?: any; error?: string }>;
  codexSendMessage: (
    workspaceId: string,
    message: string,
  ) => Promise<{ success: boolean; response?: any; error?: string }>;
  codexSendMessageStream: (
    workspaceId: string,
    message: string,
    conversationId?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  codexStopStream: (
    workspaceId: string,
  ) => Promise<{ success: boolean; stopped?: boolean; error?: string }>;
  codexGetStreamTail: (
    workspaceId: string,
  ) => Promise<{
    success: boolean;
    tail?: string;
    startedAt?: string;
    error?: string;
  }>;
  codexGetAgentStatus: (
    workspaceId: string,
  ) => Promise<{ success: boolean; agent?: any; error?: string }>;
  codexGetAllAgents: () => Promise<{
    success: boolean;
    agents?: any[];
    error?: string;
  }>;
  codexRemoveAgent: (
    workspaceId: string,
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
    }) => void,
  ) => () => void;
  onCodexStreamError: (
    listener: (data: {
      workspaceId: string;
      error: string;
      agentId: string;
      conversationId?: string;
    }) => void,
  ) => () => void;
  onCodexStreamComplete: (
    listener: (data: {
      workspaceId: string;
      exitCode: number;
      agentId: string;
      conversationId?: string;
    }) => void,
  ) => () => void;
}
