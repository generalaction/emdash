import type { Branch, FetchError } from '@shared/git';
import type { ProjectRemoteState } from '@shared/projects';
import type { Result } from '@shared/result';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { GitFetchService } from '@main/core/git/git-fetch-service';
import type { GitRepositoryService } from '@main/core/git/repository-service';
import type { ExecFn } from '@main/core/utils/exec';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import type { IDisposable } from '@main/lib/lifecycle';
import type { ConversationProvider } from '../conversations/types';
import { taskManager } from '../tasks/task-manager';
import type { TerminalProvider } from '../terminals/terminal-provider';
import type { WorkspaceType } from '../workspaces/workspace-factory';
import type { ProjectSettingsProvider } from './settings/schema';
import type { WorktreeHost } from './worktrees/hosts/worktree-host';
import type { WorktreeService } from './worktrees/worktree-service';

export type WorkspaceProviderData = {
  provisionCommand: string;
  terminateCommand: string;
  remoteWorkspaceId?: string;
};

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
  readonly sourceBranch: Branch | undefined;
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
  readonly defaultWorkspaceType: WorkspaceType;
  readonly exec: ExecFn;
  /** Used by WorktreeService and GitService construction in create-provider.ts. */
  readonly gitExec: ExecFn;
  readonly fs: FileSystemProvider;
  readonly settings: ProjectSettingsProvider;
  readonly worktreeHost: WorktreeHost;
  readonly worktreePoolPath: string;
};

export class ProjectProvider implements IDisposable {
  readonly type: string;
  readonly projectId: string;
  readonly repoPath: string;
  readonly exec: ExecFn;
  readonly settings: ProjectSettingsProvider;
  readonly repository: GitRepositoryService;
  readonly fs: FileSystemProvider;
  readonly worktreeService: WorktreeService;
  readonly gitFetchService: GitFetchService;
  /** Workspace type for standard worktree tasks. BYOI tasks use their own remote workspace type. */
  readonly defaultWorkspaceType: WorkspaceType;

  constructor(
    projectId: string,
    repoPath: string,
    transport: ProjectProviderTransport,
    repository: GitRepositoryService,
    worktreeService: WorktreeService,
    gitFetchService: GitFetchService,
    private readonly _dispose: () => void
  ) {
    this.type = transport.kind;
    this.projectId = projectId;
    this.repoPath = repoPath;
    this.exec = transport.exec;
    this.settings = transport.settings;
    this.fs = transport.fs;
    this.repository = repository;
    this.worktreeService = worktreeService;
    this.gitFetchService = gitFetchService;
    this.defaultWorkspaceType = transport.defaultWorkspaceType;
  }

  getRemoteState(): Promise<ProjectRemoteState> {
    return this.repository.getRemoteState();
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

  fetch(): Promise<Result<void, FetchError>> {
    return this.gitFetchService.fetch();
  }

  async dispose(): Promise<void> {
    this._dispose();
    this.gitFetchService.stop();
    const projectSettings = await this.settings.get();
    const mode = projectSettings.tmux ? 'detach' : 'terminate';
    await taskManager.teardownAllForProject(this.projectId, mode);
    await workspaceRegistry.releaseAllForProject(this.projectId, mode);
  }
}
