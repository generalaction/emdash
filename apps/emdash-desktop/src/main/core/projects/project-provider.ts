import type { GitBranchRef, GitHeadModel, GitSequences, IGitRuntime } from '@emdash/core/git';
import type { Result } from '@emdash/shared';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import type { GitRepositoryService } from '@main/core/git/repository/service';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import type { MachineRef } from '@main/core/runtime/types';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import type { IDisposable } from '@main/lib/lifecycle';
import type { FetchError } from '@shared/core/git/types';
import type { WorkspaceProviderData } from '@shared/core/workspaces/workspace-provider-data';
import type { ProjectRemoteState } from '@shared/projects';
import type { ConversationProvider } from '../conversations/types';
import { taskSessionManager } from '../tasks/task-session-manager';
import type { TerminalProvider } from '../terminals/terminal-provider';
import type { WorkspaceType } from '../workspaces/workspace-factory';
import type { ProjectSettingsProvider } from './settings/provider';
import type { WorktreeHost } from './worktrees/hosts/worktree-host';
import type { WorktreeService } from './worktrees/worktree-service';

export type { WorkspaceProviderData };

export type ProvisionResult = {
  taskProvider: TaskProvider;
  persistData: {
    workspaceId: string;
    workspaceProviderData?: WorkspaceProviderData;
    sshConnectionId?: string;
    worktreeGitDir?: string;
  };
};

export interface TaskProvider {
  readonly taskId: string;
  readonly taskBranch: string | undefined;
  readonly sourceBranch: GitBranchRef | undefined;
  readonly taskEnvVars: Record<string, string>;
  readonly conversations: ConversationProvider;
  readonly terminals: TerminalProvider;
}

/**
 * Transport-specific dependencies: the only things that differ between local and SSH.
 * Pure data — no lifecycle methods.
 */
export type ProjectProviderTransport = {
  readonly kind: string;
  readonly projectMachine: MachineRef;
  readonly defaultWorkspaceType: WorkspaceType;
  readonly defaultWorkspaceMachine: MachineRef;
  readonly ctx: IExecutionContext;
  readonly fs: FileSystemProvider;
  readonly settings: ProjectSettingsProvider;
  readonly worktreeHost: WorktreeHost;
};

export class ProjectProvider implements IDisposable {
  readonly type: string;
  readonly projectId: string;
  readonly repoPath: string;
  readonly projectMachine: MachineRef;
  readonly settings: ProjectSettingsProvider;
  readonly gitRepository: GitRepositoryService;
  readonly fs: FileSystemProvider;
  readonly worktreeService: WorktreeService;
  readonly gitRepositoryFetchService: GitRepositoryFetchService;
  /** Workspace type for standard worktree tasks. BYOI tasks use their own remote workspace type. */
  readonly defaultWorkspaceType: WorkspaceType;
  readonly defaultWorkspaceMachine: MachineRef;
  readonly worktreeHost: WorktreeHost;

  private readonly _ctx: IExecutionContext;

  constructor(
    projectId: string,
    repoPath: string,
    transport: ProjectProviderTransport,
    gitRepository: GitRepositoryService,
    worktreeService: WorktreeService,
    gitRepositoryFetchService: GitRepositoryFetchService,
    private readonly _gitRuntime: IGitRuntime,
    private readonly _dispose: () => void
  ) {
    this.type = transport.kind;
    this.projectId = projectId;
    this.repoPath = repoPath;
    this.projectMachine = transport.projectMachine;
    this._ctx = transport.ctx;
    this.settings = transport.settings;
    this.fs = transport.fs;
    this.gitRepository = gitRepository;
    this.worktreeService = worktreeService;
    this.gitRepositoryFetchService = gitRepositoryFetchService;
    this.defaultWorkspaceType = transport.defaultWorkspaceType;
    this.defaultWorkspaceMachine = transport.defaultWorkspaceMachine;
    this.worktreeHost = transport.worktreeHost;
  }

  get ctx(): IExecutionContext {
    return this._ctx;
  }

  getRemoteState(): Promise<ProjectRemoteState> {
    return this.gitRepository.getRemoteState();
  }

  getWorktreeForBranch(branchName: string): Promise<string | undefined> {
    return this.worktreeService.getWorktree(branchName);
  }

  async removeTaskWorktree(taskBranch: string): Promise<void> {
    const worktreePath = await this.worktreeService.getWorktree(taskBranch);
    if (worktreePath) {
      await this.worktreeService.removeWorktree(worktreePath);
    }
  }

  fetch(): Promise<Result<{ sequences: GitSequences }, FetchError>> {
    return this.gitRepositoryFetchService.fetch();
  }

  async getProjectRootHead(): Promise<GitHeadModel> {
    const lease = await this._gitRuntime.openWorktree(this.repoPath);
    try {
      return await lease.value.getHead();
    } finally {
      lease.release();
    }
  }

  async dispose(): Promise<void> {
    this._dispose();
    this.gitRepositoryFetchService.stop();
    const projectSettings = await this.settings.get();
    const mode = projectSettings.tmux ? 'detach' : 'terminate';
    await taskSessionManager.teardownAllForProject(this.projectId, mode);
    await workspaceRegistry.releaseAllForProject(this.projectId, mode);
    await previewServerService.stopForProject(this.projectId);
  }
}
