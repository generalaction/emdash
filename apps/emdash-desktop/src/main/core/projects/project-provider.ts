import type { GitBranchRef, RepositorySelector } from '@emdash/core/runtimes/git/api';
import type { Disposable } from '@emdash/shared/concurrency';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FilesClientScope } from '@main/core/files/runtime-client';
import type { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import type { GitRepositoryService } from '@main/core/git/repository/service';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import type { GitRuntimeClient } from '@main/core/wire-workers/accessors';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import type { SetupResult } from '@main/core/workspaces/workspace-setup-executor';
import type { WorkspaceProviderData } from '@shared/core/workspaces/workspace-provider-data';
import type { WorkspaceSetupSpec } from '@shared/core/workspaces/workspace-setup-spec';
import type { ProjectRemoteState } from '@shared/projects';
import type { ConversationProvider } from '../conversations/types';
import { taskSessionManager } from '../tasks/task-session-manager';
import type { WorkspaceType } from '../workspaces/workspace-factory';
import type { ProjectSettingsProvider } from './settings/provider';
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
}

type RunWorkspaceSetup = (args: {
  spec: WorkspaceSetupSpec;
  worktreePoolPath: string;
}) => Promise<SetupResult>;

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
  /**
   * Transitional provisioning hook. Workspace setup currently still runs in the
   * desktop app with direct access to local runtimes; this should move behind
   * the workspace server/core boundary and disappear from ProjectProvider.
   */
  readonly runWorkspaceSetup: RunWorkspaceSetup;
  readonly settings: ProjectSettingsProvider;
};

export class ProjectProvider implements Disposable {
  readonly type: string;
  readonly projectId: string;
  readonly repoPath: string;
  readonly settings: ProjectSettingsProvider;
  readonly git: GitRuntimeClient;
  readonly repository: RepositorySelector;
  readonly gitRepository: GitRepositoryService;
  readonly files: FilesClientScope;
  readonly projectConfigPath: string;
  readonly worktreeService: WorktreeService;
  /** Workspace type for standard worktree tasks. BYOI tasks use their own remote workspace type. */
  readonly defaultWorkspaceType: WorkspaceType;

  private readonly _ctx: IExecutionContext;
  private readonly _resolveProjectPath: (relativePath: string) => string;
  private readonly _configPathForDirectory: (directoryPath: string) => string;
  private readonly _runWorkspaceSetup: RunWorkspaceSetup;

  constructor(
    projectId: string,
    repoPath: string,
    transport: ProjectProviderTransport,
    gitRepository: GitRepositoryService,
    worktreeService: WorktreeService,
    private readonly gitRepositoryFetchService: GitRepositoryFetchService,
    git: GitRuntimeClient,
    repository: RepositorySelector,
    private readonly _releaseProjectLeases: () => void | Promise<void>
  ) {
    this.type = transport.kind;
    this.projectId = projectId;
    this.repoPath = repoPath;
    this._ctx = transport.ctx;
    this.settings = transport.settings;
    this.files = transport.files;
    this.projectConfigPath = transport.projectConfigPath;
    this._resolveProjectPath = transport.resolveProjectPath;
    this._configPathForDirectory = transport.configPathForDirectory;
    this._runWorkspaceSetup = transport.runWorkspaceSetup;
    this.git = git;
    this.repository = repository;
    this.gitRepository = gitRepository;
    this.worktreeService = worktreeService;
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

  /**
   * Transitional provisioning hook. See ProjectProviderTransport.
   */
  runWorkspaceSetup(spec: WorkspaceSetupSpec, worktreePoolPath: string): Promise<SetupResult> {
    return this._runWorkspaceSetup({ spec, worktreePoolPath });
  }

  getRemoteState(): Promise<ProjectRemoteState> {
    return this.gitRepository.getRemoteState();
  }

  async removeTaskWorktree(taskBranch: string): Promise<void> {
    const worktreePath = await this.worktreeService.getWorktree(taskBranch);
    if (worktreePath) {
      await this.worktreeService.removeWorktree(worktreePath);
    }
  }

  async release(): Promise<void> {
    this.gitRepositoryFetchService.stop();
    const results = await Promise.allSettled([
      workspaceRegistry.releaseLeasesForProject(this.projectId),
      this._releaseProjectLeases(),
    ]);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  async dispose(): Promise<void> {
    try {
      this.gitRepositoryFetchService.stop();
      const projectSettings = await this.settings.get();
      const mode = projectSettings.tmux ? 'detach' : 'terminate';
      await taskSessionManager.teardownAllForProject(this.projectId, mode);
      await workspaceRegistry.teardownAllForProject(this.projectId, mode);
      await previewServerService.stopForProject(this.projectId);
    } finally {
      await this.release();
    }
  }
}
