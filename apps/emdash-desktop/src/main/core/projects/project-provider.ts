import type { GitBranchRef, RepositorySelector } from '@emdash/core/runtimes/git/api';
import { workspaceContract } from '@emdash/core/runtimes/workspace/api';
import type { Disposable } from '@emdash/shared/concurrency';
import { createLiveJobReplica, LiveJobFailedError } from '@emdash/wire';
import {
  hostFileRefFromNativePath,
  nativePathFromHost,
} from '@core/primitives/desktop-runtime/api';
import type { Project, ProjectRemoteState } from '@core/primitives/projects/api';
import type { WorkspaceProviderData } from '@core/primitives/workspaces/api';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FilesClientScope } from '@main/core/files/runtime-client';
import type { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import type { GitRepositoryService } from '@main/core/git/repository/service';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import { workspacePlacementResolver } from '@main/core/workspaces/placement/workspace-placement-resolver';
import type { GitRuntimeClient, WorkspaceRuntimeClient } from '@main/gateway/accessors';
import type { ConversationProvider } from '../conversations/types';
import { taskSessionManager } from '../tasks/task-session-manager';
import type { WorkspaceType } from '../workspaces/workspace-factory';
import type { ProjectSettingsProvider } from './settings/provider';

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
}

/**
 * Transport-specific dependencies: the only things that differ between local and SSH.
 * Pure data — no lifecycle methods.
 */
export type ProjectProviderTransport = {
  readonly kind: string;
  readonly defaultWorkspaceType: WorkspaceType;
  readonly ctx: IExecutionContext;
  readonly files: FilesClientScope;
  readonly projectConfigPath: string;
  /**
   * Transitional desktop-owned path helper. Remove once project config reads/writes
   * are served by the workspace server/core boundary instead of main-process adapters.
   */
  readonly resolveProjectPath: (relativePath: string) => string;
  /**
   * Transitional desktop-owned path helper. Remove with resolveProjectPath when
   * config target resolution moves behind the workspace server/core boundary.
   */
  readonly configPathForDirectory: (directoryPath: string) => string;
  readonly settings: ProjectSettingsProvider;
};

export class ProjectProvider implements Disposable {
  readonly type: string;
  readonly project: Project;
  readonly projectId: string;
  readonly repoPath: string;
  readonly settings: ProjectSettingsProvider;
  readonly git: GitRuntimeClient;
  readonly repository: RepositorySelector;
  readonly gitRepository: GitRepositoryService;
  readonly files: FilesClientScope;
  readonly projectConfigPath: string;
  readonly workspace: WorkspaceRuntimeClient;
  /** Workspace type for standard worktree tasks. BYOI tasks use their own remote workspace type. */
  readonly defaultWorkspaceType: WorkspaceType;

  private readonly _ctx: IExecutionContext;
  private readonly _resolveProjectPath: (relativePath: string) => string;
  private readonly _configPathForDirectory: (directoryPath: string) => string;

  constructor(
    project: Project,
    transport: ProjectProviderTransport,
    gitRepository: GitRepositoryService,
    private readonly gitRepositoryFetchService: GitRepositoryFetchService,
    git: GitRuntimeClient,
    workspace: WorkspaceRuntimeClient,
    repository: RepositorySelector,
    private readonly _releaseProjectLeases: () => void | Promise<void>
  ) {
    this.type = transport.kind;
    this.project = project;
    this.projectId = project.id;
    this.repoPath = project.path;
    this._ctx = transport.ctx;
    this.settings = transport.settings;
    this.files = transport.files;
    this.projectConfigPath = transport.projectConfigPath;
    this._resolveProjectPath = transport.resolveProjectPath;
    this._configPathForDirectory = transport.configPathForDirectory;
    this.git = git;
    this.workspace = workspace;
    this.repository = repository;
    this.gitRepository = gitRepository;
    this.defaultWorkspaceType = transport.defaultWorkspaceType;
  }

  get ctx(): IExecutionContext {
    return this._ctx;
  }

  /**
   * Transitional desktop-owned path helper. See ProjectProviderTransport.
   */
  resolveProjectPath(relativePath: string): string {
    return this._resolveProjectPath(relativePath);
  }

  /**
   * Transitional desktop-owned path helper. See ProjectProviderTransport.
   */
  configPathForDirectory(directoryPath: string): string {
    return this._configPathForDirectory(directoryPath);
  }

  getRemoteState(): Promise<ProjectRemoteState> {
    return this.gitRepository.getRemoteState();
  }

  async findTaskWorktree(taskBranch: string): Promise<string | null> {
    const worktrees = await this.git.repository.listWorktrees(this.repository);
    if (!worktrees.success) {
      throw new Error(worktrees.error.message ?? `Failed to list worktrees for ${this.repoPath}`);
    }
    const worktree = worktrees.data.find(
      (candidate) =>
        !candidate.isMain &&
        !candidate.prunable &&
        candidate.head.kind === 'branch' &&
        candidate.head.name === taskBranch
    );
    return worktree ? nativePathFromHost(worktree.worktreePath) : null;
  }

  async removeTaskWorktree(taskBranch: string): Promise<void> {
    const worktreePath = await this.findTaskWorktree(taskBranch);
    if (worktreePath) {
      const pool = await workspacePlacementResolver.resolveWorktreePool(this.project);
      if (!pool.success) throw new Error(pool.error.message);

      const connectionId = this.project.type === 'ssh' ? this.project.connectionId : undefined;
      const jobs = createLiveJobReplica(workspaceContract.teardown, this.workspace.teardown);
      const lease = await jobs.start({
        workspace: hostFileRefFromNativePath(worktreePath, connectionId),
        force: true,
        lifecycle: {
          ref: {
            kind: 'worktree',
            repoPath: this.repoPath,
            path: worktreePath,
            branchName: taskBranch,
          },
          context: {
            repoPath: this.repoPath,
            preservePatterns: [],
            worktreePoolPath: pool.data,
          },
          deleteBranch: false,
        },
      });
      try {
        const job = await lease.ready();
        await job.result;
      } catch (error) {
        if (error instanceof LiveJobFailedError) throw new Error(error.error?.message);
        throw error;
      } finally {
        await lease.release();
        await jobs.dispose();
      }
    }
  }

  async release(): Promise<void> {
    this.gitRepositoryFetchService.stop();
    await this._releaseProjectLeases();
  }

  async dispose(): Promise<void> {
    try {
      this.gitRepositoryFetchService.stop();
      const projectSettings = await this.settings.get();
      const mode = projectSettings.tmux ? 'detach' : 'terminate';
      await taskSessionManager.teardownAllForProject(this.projectId, mode);
      await previewServerService.stopForProject(this.projectId);
    } finally {
      await this.release();
    }
  }
}
