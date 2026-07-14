import path from 'node:path';
import type { HostFileRef } from '@emdash/core/primitives/path/api';
import type { GitBranchRef } from '@emdash/core/runtimes/git/api';
import {
  compileBootstrapPlan,
  normalizeLegacyWorkspaceAutomation,
  workspaceContract,
  type ActivateWorkspaceInput,
  type BootstrapGitIntent,
  type BootstrapRepositoryInitialize,
  type ProvisionWorkspaceInput,
  type RunWorkspaceScriptInput,
  type WorkspaceLifecyclePlans,
  type WorkspaceOperationProgress,
  type WorkspaceOperationResult,
  type WorkspaceError,
} from '@emdash/core/runtimes/workspace/api';
import { err, ok, type Result } from '@emdash/shared';
import { createLiveJobReplica, LiveJobCancelledError, LiveJobFailedError } from '@emdash/wire';
import { eq, sql } from 'drizzle-orm';
import { filesClientScope } from '@main/core/files/runtime-client';
import { projectManager } from '@main/core/projects/project-manager';
import type { ProjectProvider, TaskProvider } from '@main/core/projects/project-provider';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import {
  formatProvisionTaskError,
  mapWorktreeErrorToProvisionError,
} from '@main/core/tasks/provision-task-error';
import { buildTaskFromWorkspace, emitTaskProvisionProgress } from '@main/core/tasks/task-builder';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { getFilesRuntimeClient } from '@main/core/wire-workers/accessors';
import { db as appDb, type AppDb } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { Task, ProvisionWorkspaceError } from '@shared/core/tasks/tasks';
import type { GitSetup, WorkspaceLocation } from '@shared/core/tasks/tasks';
import type {
  WorkspaceBootstrapProgress,
  WorkspaceBootstrapStep,
  WorkspaceCloneProvisionResult,
} from '@shared/core/workspaces/wire-contract';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';
import type { WorkspaceProviderData } from '@shared/core/workspaces/workspace-provider-data';
import { compileSetupSpec } from '@shared/core/workspaces/workspace-setup-spec';
import type { WorkspaceType } from '@shared/core/workspaces/workspaces';
import { deriveBranchName, resolveWorkspaceIntent } from '../tasks/resolve-workspace-intent';
import { provisionBYOITask } from './byoi/provision-byoi-task';
import {
  getWorkspaceRuntimeClient,
  hostFileRefFromNativePath,
} from './runtime/workspace-runtime-host';
import { getProvisionedWorkspaceBranch } from './workspace-branch';
import { createWorkspaceFactory } from './workspace-factory';
import { computeWorkspaceKey } from './workspace-key';
import { workspaceRegistry } from './workspace-registry';

export type WorkspaceBootstrapResult = {
  path: string;
  workspaceId: string;
  runtimeWorkspace: HostFileRef;
  sshConnectionId?: string;
  worktreeGitDir?: string;
  taskProvider: TaskProvider;
  postActivationAutomation?: ActivateWorkspaceInput['automation'];
  /** BYOI only — workspace provider data to persist in the DB. */
  workspaceProviderData?: WorkspaceProviderData;
};

type RuntimeWorkspacePlan = {
  path: string;
  workspace: ProvisionWorkspaceInput['workspace'];
  lifecycle?: WorkspaceLifecyclePlans;
};

export type CloneRepositoryProvisionInput = {
  url: string;
  destination: string;
  remoteName?: string;
  depth?: number;
  initialize?: BootstrapRepositoryInitialize;
  signal?: AbortSignal;
  onProgress?: (progress: WorkspaceBootstrapProgress) => void;
};

export class WorkspaceBootstrapService {
  constructor(private readonly db: AppDb) {}

  /**
   * Ensures the workspace for a task is fully set up on disk, acquires the
   * workspace (running lifecycle scripts), and builds task providers.
   *
   * - **Fast path (idempotent)**: if a non-worktree `workspaceRow.path` is set and
   *   the directory exists on disk, skips git setup and goes straight to workspace
   *   acquisition. Persisted worktree paths are resolved through `WorktreeService`
   *   so stale partial directories are repaired before acquisition.
   * - **BYOI workspaces**: delegates to `provisionBYOITask` which runs the
   *   provision script, connects SSH, and acquires the workspace.
   * - **Local/SSH workspaces**: compiles and executes the `WorkspaceSetupSpec`,
   *   applies recovery on failure, persists the resolved path, then acquires.
   * - **SSH channel recovery**: calls `reportChannelRecovered` after a successful
   *   setup on an SSH project.
   */
  async ensureWorkspaceSetup(
    workspaceRow: {
      id: string;
      type: WorkspaceType;
      kind?: string | null;
      path: string | null;
      config?: WorkspaceConfig | null;
      branchName?: string | null;
      workspaceProvider?: string | null;
      data?: WorkspaceProviderData | null;
    },
    taskRow: {
      workspaceIntent: string | null;
      workspaceProvider: string | null;
      taskBranch?: string | null;
    },
    task: Task,
    project: ProjectProvider
  ): Promise<Result<WorkspaceBootstrapResult, ProvisionWorkspaceError>> {
    const wsKind = workspaceRow.kind;
    const isByoi = wsKind === 'byoi' || workspaceRow.type === 'byoi';

    // Derive branch info from workspace config for passing to task providers.
    const wsConfig = workspaceRow.config;
    const workspaceBranchName = getProvisionedWorkspaceBranch(workspaceRow) ?? undefined;
    const isWorktreeWorkspace = wsKind === 'worktree' || (!wsKind && !!workspaceBranchName);
    const workspaceSourceBranch: GitBranchRef | undefined =
      wsConfig?.git.kind === 'create-branch' ? wsConfig.git.fromBranch : undefined;
    const connectionId =
      project.defaultWorkspaceType.kind === 'ssh'
        ? project.defaultWorkspaceType.connectionId
        : undefined;

    // project-root fast-path: use the project repo path directly.
    // Path is set by ensureRepositoryWorkspace at mount time.
    if (wsKind === 'project-root') {
      const resolvedPath = workspaceRow.path ?? project.repoPath;
      return this._acquireAndBuild(
        workspaceRow.id,
        task,
        project,
        resolvedPath,
        {
          path: resolvedPath,
          workspace: hostFileRefFromNativePath(resolvedPath, connectionId),
        },
        workspaceBranchName,
        workspaceSourceBranch
      );
    }

    // Persisted worktree path: resolve through WorktreeService instead of trusting
    // path existence. Archive/delete can leave a partial directory behind; the
    // worktree service knows how to remove stale targets and recreate the checkout.
    if (workspaceRow.path && workspaceBranchName && isWorktreeWorkspace && !isByoi) {
      const serveResult = await project.worktreeService.serveBranchWorktree(
        workspaceBranchName,
        workspaceSourceBranch
      );
      if (!serveResult.success) {
        const provisionError = mapWorktreeErrorToProvisionError(
          workspaceBranchName,
          serveResult.error
        );
        return err({
          type: 'setup-failed',
          stepKind: 'worktree',
          stepErrorType: provisionError.type,
          message: formatProvisionTaskError(provisionError),
        });
      }
      const resolvedPath = serveResult.data;

      await this.persistPath(
        workspaceRow.id,
        resolvedPath,
        workspaceRow.type,
        connectionId,
        workspaceBranchName
      );

      if (connectionId) {
        sshConnectionManager.reportChannelRecovered(connectionId);
      }

      return this._acquireAndBuild(
        workspaceRow.id,
        task,
        project,
        resolvedPath,
        {
          path: resolvedPath,
          workspace: hostFileRefFromNativePath(resolvedPath, connectionId),
        },
        workspaceBranchName,
        workspaceSourceBranch
      );
    }

    // Fast path: non-worktree path already persisted and still exists on disk.
    if (workspaceRow.path && !isByoi && !isWorktreeWorkspace) {
      const exists = await project.worktreeService.existsAtAbsolutePath(workspaceRow.path);
      if (exists) {
        return this._acquireAndBuild(
          workspaceRow.id,
          task,
          project,
          workspaceRow.path,
          {
            path: workspaceRow.path,
            workspace: hostFileRefFromNativePath(workspaceRow.path, connectionId),
          },
          workspaceBranchName,
          workspaceSourceBranch
        );
      }
    }

    // BYOI workspaces are managed by provisionBYOITask.
    if (isByoi) {
      return this._provisionBYOI(workspaceRow, task, project);
    }

    const intent = resolveWorkspaceIntent(taskRow, workspaceRow);
    if (!intent) {
      return err({ type: 'no-intent' });
    }

    const runtimePlan = await this.compileRuntimeWorkspacePlan(intent, project, connectionId);

    const intentBranchName = deriveBranchName(intent.git) ?? undefined;
    const intentSourceBranch: GitBranchRef | undefined =
      intent.git.kind === 'create-branch' ? intent.git.fromBranch : undefined;

    if (!runtimePlan.lifecycle?.setupPlan || runtimePlan.lifecycle.setupPlan.steps.length === 0) {
      await this.persistPath(
        workspaceRow.id,
        runtimePlan.path,
        workspaceRow.type,
        connectionId,
        intentBranchName
      );
      return this._acquireAndBuild(
        workspaceRow.id,
        task,
        project,
        runtimePlan.path,
        runtimePlan,
        intentBranchName,
        intentSourceBranch
      );
    }

    const { baseRemote, pushRemote } = await project.gitRepository.getConfiguredRemotes();
    const legacySpec = compileSetupSpec(intent.git, intent.workspace, { baseRemote, pushRemote });
    const worktreePoolPath = await project.worktreeService.getWorktreePoolPath();
    const setupResult = await project.runWorkspaceSetup(legacySpec, worktreePoolPath);
    if (!setupResult.success) {
      const { kind, type } = setupResult.error;
      const message = 'message' in setupResult.error ? setupResult.error.message : undefined;
      return err({ type: 'setup-failed', stepKind: kind, stepErrorType: type, message });
    }

    const resolvedPath = setupResult.data.path;
    const provisionResult = await runWorkspaceProvisionJob(task, project, {
      workspace: hostFileRefFromNativePath(resolvedPath, connectionId),
    });
    if (!provisionResult.success) {
      emitTaskProvisionProgress({
        taskId: task.id,
        projectId: project.projectId,
        step: 'setting-up-workspace',
        message: `Workspace runtime provision skipped: ${provisionResult.error.message}`,
      });
    }
    if (resolvedPath) {
      await this.persistPath(
        workspaceRow.id,
        resolvedPath,
        workspaceRow.type,
        connectionId,
        intentBranchName
      );
    }

    if (connectionId) {
      sshConnectionManager.reportChannelRecovered(connectionId);
    }

    return this._acquireAndBuild(
      workspaceRow.id,
      task,
      project,
      resolvedPath ?? '',
      {
        ...runtimePlan,
        path: resolvedPath ?? runtimePlan.path,
        workspace: hostFileRefFromNativePath(resolvedPath ?? runtimePlan.path, connectionId),
      },
      intentBranchName,
      intentSourceBranch
    );
  }

  /**
   * Public entry point for the RPC controller.
   * Loads the workspace + task rows from DB, resolves the project,
   * and delegates to `ensureWorkspaceSetup`.
   */
  async ensureWorkspaceSetupForTask(
    taskId: string
  ): Promise<Result<WorkspaceBootstrapResult, ProvisionWorkspaceError>> {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!row?.workspaceId) return err({ type: 'missing-workspace' });

    const [wsRow] = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, row.workspaceId))
      .limit(1);
    if (!wsRow) return err({ type: 'missing-workspace' });

    const project = projectManager.getProject(row.projectId);
    if (!project) throw new Error(`Project ${row.projectId} not found`);

    const task = mapTaskRowToTask(row);
    return this.ensureWorkspaceSetup(wsRow, row, task, project);
  }

  /**
   * Persists a resolved path (and its derived key) onto a workspace row.
   *
   * If another workspace already owns that path (same key), its ID is returned
   * so the caller can re-point any tasks. Returns the original workspaceId when
   * the update succeeds normally.
   *
   * @internal Exposed for unit testing; prefer `ensureWorkspaceSetup` in application code.
   */
  async persistPath(
    workspaceId: string,
    path: string,
    type: WorkspaceType,
    connectionId?: string,
    branchName?: string
  ): Promise<string> {
    const key = type !== 'byoi' ? computeWorkspaceKey(type, path, connectionId) : null;

    if (key) {
      const [existing] = await this.db.select().from(workspaces).where(eq(workspaces.key, key));
      if (existing && existing.id !== workspaceId) {
        return existing.id;
      }
    }

    await this.db
      .update(workspaces)
      .set({ path, key, branchName: branchName ?? null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(workspaces.id, workspaceId));
    return workspaceId;
  }

  private async compileRuntimeWorkspacePlan(
    intent: { git: GitSetup; workspace: WorkspaceLocation },
    project: ProjectProvider,
    connectionId: string | undefined
  ): Promise<RuntimeWorkspacePlan> {
    const projectSettings = (await project.settings.get()) ?? {};
    const context = {
      repoPath: project.repoPath,
      preservePatterns: projectSettings.preservePatterns ?? [],
    };

    if (intent.git.kind === 'none') {
      const workspacePath =
        intent.workspace.host !== 'byoi' && intent.workspace.path
          ? intent.workspace.path
          : project.repoPath;
      return {
        path: workspacePath,
        workspace: hostFileRefFromNativePath(workspacePath, connectionId),
        lifecycle: {
          ref: { kind: 'directory', path: workspacePath },
          context,
          setupPlan: { steps: [] },
        },
      };
    }

    const bootstrapIntent = toBootstrapGitIntent(intent.git);
    const { baseRemote } = await project.gitRepository.getConfiguredRemotes();
    const worktreePoolPath = await project.worktreeService.getWorktreePoolPath();
    const compiled = compileBootstrapPlan(bootstrapIntent, {
      worktreePoolPath,
      baseRemote,
    });
    const branchName = deriveBranchName(intent.git);
    const ref =
      branchName !== null
        ? {
            kind: 'worktree' as const,
            repoPath: project.repoPath,
            path: compiled.workspacePath,
            branchName,
          }
        : { kind: 'directory' as const, path: compiled.workspacePath };

    return {
      path: compiled.workspacePath,
      workspace: hostFileRefFromNativePath(compiled.workspacePath, connectionId),
      lifecycle: {
        ref,
        context,
        setupPlan: compiled.plan,
      },
    };
  }

  private async resolveLegacyAutomation(
    task: Task,
    project: ProjectProvider,
    workDir: string
  ): Promise<ActivateWorkspaceInput['automation']> {
    const projectSettings = await project.settings.get();
    if (!projectSettings) return undefined;

    const filesClient = await getFilesRuntimeClient();
    const taskFiles = filesClientScope(filesClient, workDir);
    const taskConfigPath = path.join(workDir, '.emdash.json');
    const taskSettings = await getEffectiveTaskSettings({
      projectSettings: project.settings,
      taskFiles,
      taskConfigPath,
    });

    return normalizeLegacyWorkspaceAutomation({
      scripts: taskSettings.scripts,
      shellSetup: taskSettings.shellSetup ?? projectSettings.shellSetup,
      autoRunSetup: projectSettings.autoRunSetupScriptOnTaskCreation ?? true,
      autoRunRun: projectSettings.autoRunRunScriptOnTaskCreation ?? false,
    });
  }

  /**
   * Acquires the workspace via the registry (runs lifecycle scripts on first
   * acquire) then builds task providers. Returns a `WorkspaceBootstrapResult`.
   */
  private async _acquireAndBuild(
    workspaceId: string,
    task: Task,
    project: ProjectProvider,
    workDir: string,
    runtimePlan: RuntimeWorkspacePlan,
    workspaceBranchName?: string,
    workspaceSourceBranch?: GitBranchRef
  ): Promise<Result<WorkspaceBootstrapResult, ProvisionWorkspaceError>> {
    const type = project.defaultWorkspaceType;

    emitTaskProvisionProgress({
      taskId: task.id,
      projectId: project.projectId,
      step: 'initialising-workspace',
      message: 'Initialising workspace…',
    });

    const automation = await this.resolveLegacyAutomation(task, project, workDir);
    const activation = await runWorkspaceActivateJob(task, project, {
      workspace: runtimePlan.workspace,
      consumerId: task.id,
      automation,
      lifecycle: runtimePlan.lifecycle,
    });
    if (!activation.success) {
      emitTaskProvisionProgress({
        taskId: task.id,
        projectId: project.projectId,
        step: 'initialising-workspace',
        message: `Workspace runtime activation skipped: ${activation.error.message}`,
      });
    }

    let acquired;
    try {
      acquired = await workspaceRegistry.acquire(
        workspaceId,
        project.projectId,
        createWorkspaceFactory(workspaceId, type, {
          task,
          workDir,
          projectId: project.projectId,
          projectPath: project.repoPath,
          settings: project.settings,
          logPrefix: 'WorkspaceBootstrapService',
        })
      );
    } catch (e) {
      await runWorkspaceDeactivateJob(task, runtimePlan.workspace).catch(() => {});
      return err({
        type: 'setup-failed',
        stepKind: 'workspace-acquire',
        stepErrorType: 'error',
        message: String(e),
      });
    }

    emitTaskProvisionProgress({
      taskId: task.id,
      projectId: project.projectId,
      step: 'starting-sessions',
      message: 'Preparing task…',
    });

    let buildSucceeded = false;
    try {
      const buildResult = await buildTaskFromWorkspace(
        task,
        acquired.workspace,
        type,
        project.projectId,
        project.repoPath,
        project.settings,
        workspaceBranchName,
        workspaceSourceBranch
      );
      buildSucceeded = true;
      return ok({
        path: workDir,
        workspaceId,
        runtimeWorkspace: runtimePlan.workspace,
        sshConnectionId: type.kind === 'ssh' ? type.connectionId : undefined,
        worktreeGitDir: undefined,
        taskProvider: buildResult.taskProvider,
        postActivationAutomation: automation,
      });
    } catch (e) {
      await runWorkspaceDeactivateJob(task, runtimePlan.workspace).catch(() => {});
      return err({
        type: 'setup-failed',
        stepKind: 'build-providers',
        stepErrorType: 'error',
        message: String(e),
      });
    } finally {
      if (!buildSucceeded) {
        await workspaceRegistry.teardown(workspaceId, 'terminate').catch(() => {});
      }
    }
  }

  /**
   * Provisions a BYOI workspace by delegating to `provisionBYOITask`.
   */
  private async _provisionBYOI(
    workspaceRow: {
      id: string;
      workspaceProvider?: string | null;
      data?: WorkspaceProviderData | null;
    },
    task: Task,
    project: ProjectProvider
  ): Promise<Result<WorkspaceBootstrapResult, ProvisionWorkspaceError>> {
    const projectSettings = await project.settings.get();
    if (projectSettings.workspaceProvider?.type !== 'script') {
      return err({
        type: 'setup-failed',
        stepKind: 'byoi-config',
        stepErrorType: 'missing-provider',
        message: 'Task has workspaceProvider=byoi but project has no script provider configured',
      });
    }

    try {
      const result = await provisionBYOITask({
        task,
        wpConfig: projectSettings.workspaceProvider,
        ctx: project.ctx,
        projectId: project.projectId,
        projectPath: project.repoPath,
        settings: project.settings,
        logPrefix: `${project.type}ProjectProvider[byoi]`,
        workspaceId: workspaceRow.id,
      });
      return ok({
        ...result,
        runtimeWorkspace: hostFileRefFromNativePath(result.path, result.sshConnectionId),
      });
    } catch (e) {
      return err({
        type: 'setup-failed',
        stepKind: 'byoi-provision',
        stepErrorType: 'error',
        message: String(e),
      });
    }
  }
}

function toBootstrapGitIntent(git: Exclude<GitSetup, { kind: 'none' }>): BootstrapGitIntent {
  switch (git.kind) {
    case 'use-branch':
      return {
        kind: 'use-branch',
        branchName: git.branchName,
      };
    case 'create-branch':
      return {
        kind: 'create-branch',
        branchName: git.branchName,
        fromBranch: git.fromBranch,
      };
    case 'pr-branch':
      return {
        kind: 'pr-branch',
        prNumber: git.prNumber,
        headBranch: git.headBranch,
        headRepositoryUrl: git.headRepositoryUrl,
        isFork: git.isFork,
        taskBranch: git.taskBranch,
      };
  }
}

async function runWorkspaceProvisionJob(
  task: Task,
  project: ProjectProvider,
  input: ProvisionWorkspaceInput
): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
  const workspaceRuntimeClient = getWorkspaceRuntimeClient();
  const jobs = createLiveJobReplica(workspaceContract.provision, workspaceRuntimeClient.provision);
  const lease = await jobs.start(input);
  const job = await lease.ready();
  const unsubscribe = job.onProgress((progress) =>
    emitRuntimeProgress(task.id, project.projectId, progress)
  );

  try {
    return ok(await job.result);
  } catch (error) {
    return err(liveJobErrorToWorkspaceError(error));
  } finally {
    unsubscribe();
    await lease.release();
    await jobs.dispose();
  }
}

export async function runCloneRepositoryProvision(
  input: CloneRepositoryProvisionInput
): Promise<Result<WorkspaceCloneProvisionResult, WorkspaceError>> {
  const compiled = compileBootstrapPlan(
    {
      kind: 'clone-repository',
      url: input.url,
      destination: input.destination,
      remoteName: input.remoteName,
      depth: input.depth,
      initialize: input.initialize,
    },
    {
      worktreePoolPath: path.dirname(input.destination),
      baseRemote: input.remoteName ?? 'origin',
    }
  );
  const workspaceRuntimeClient = getWorkspaceRuntimeClient();
  const jobs = createLiveJobReplica(workspaceContract.provision, workspaceRuntimeClient.provision);
  const lease = await jobs.start({
    workspace: hostFileRefFromNativePath(compiled.workspacePath),
    lifecycle: {
      ref: { kind: 'directory', path: compiled.workspacePath },
      context: {
        repoPath: compiled.workspacePath,
        preservePatterns: [],
      },
      setupPlan: compiled.plan,
    },
  });
  const job = await lease.ready();
  const unsubscribe = job.onProgress((progress) =>
    input.onProgress?.(workspaceRuntimeProgressToBootstrapProgress(progress))
  );
  const cancelRuntimeJob = () => void job.cancel();
  input.signal?.addEventListener('abort', cancelRuntimeJob, { once: true });

  try {
    const result = await job.result;
    return ok({ path: result.path ?? compiled.workspacePath });
  } catch (error) {
    return err(liveJobErrorToWorkspaceError(error));
  } finally {
    input.signal?.removeEventListener('abort', cancelRuntimeJob);
    unsubscribe();
    await lease.release();
    await jobs.dispose();
  }
}

async function runWorkspaceActivateJob(
  task: Task,
  project: ProjectProvider,
  input: ActivateWorkspaceInput
): Promise<Result<unknown, WorkspaceError>> {
  const workspaceRuntimeClient = getWorkspaceRuntimeClient();
  const jobs = createLiveJobReplica(workspaceContract.activate, workspaceRuntimeClient.activate);
  const lease = await jobs.start(input);
  const job = await lease.ready();
  const unsubscribe = job.onProgress((progress) =>
    emitRuntimeProgress(task.id, project.projectId, progress)
  );

  try {
    return ok(await job.result);
  } catch (error) {
    return err(liveJobErrorToWorkspaceError(error));
  } finally {
    unsubscribe();
    await lease.release();
    await jobs.dispose();
  }
}

export function startWorkspacePostActivationScripts(
  task: Task,
  project: ProjectProvider,
  result: WorkspaceBootstrapResult
): void {
  const automation = result.postActivationAutomation;
  if (!automation) return;

  void runWorkspacePostActivationScripts(task, project, {
    workspace: result.runtimeWorkspace,
    automation,
  }).catch((error: unknown) => {
    log.warn('Workspace post-activation scripts failed', {
      taskId: task.id,
      workspaceId: result.workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function runWorkspacePostActivationScripts(
  task: Task,
  project: ProjectProvider,
  input: Pick<RunWorkspaceScriptInput, 'workspace' | 'automation'>
): Promise<void> {
  let setupSucceeded = true;

  if (input.automation.setup && input.automation.autoRunSetup) {
    const result = await runWorkspaceScriptJob(task, project, {
      ...input,
      consumerId: task.id,
      script: 'setup',
    });
    setupSucceeded = result.success;
  }

  if (setupSucceeded && input.automation.run && input.automation.autoRunRun) {
    await runWorkspaceScriptJob(task, project, {
      ...input,
      consumerId: task.id,
      script: 'run',
    });
  }
}

async function runWorkspaceScriptJob(
  task: Task,
  project: ProjectProvider,
  input: RunWorkspaceScriptInput
): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
  const workspaceRuntimeClient = getWorkspaceRuntimeClient();
  const jobs = createLiveJobReplica(workspaceContract.runScript, workspaceRuntimeClient.runScript);
  const lease = await jobs.start(input);
  const job = await lease.ready();

  try {
    return ok(await job.result);
  } catch (error) {
    const workspaceError = liveJobErrorToWorkspaceError(error);
    log.warn('Workspace script failed', {
      taskId: task.id,
      projectId: project.projectId,
      script: input.script,
      error: workspaceError.message,
    });
    return err(workspaceError);
  } finally {
    await lease.release();
    await jobs.dispose();
  }
}

async function runWorkspaceDeactivateJob(
  task: Task,
  workspace: ActivateWorkspaceInput['workspace']
): Promise<void> {
  const workspaceRuntimeClient = getWorkspaceRuntimeClient();
  const jobs = createLiveJobReplica(
    workspaceContract.deactivate,
    workspaceRuntimeClient.deactivate
  );
  const lease = await jobs.start({
    workspace,
    consumerId: task.id,
    strategy: 'stop',
  });
  try {
    const job = await lease.ready();
    await job.result;
  } finally {
    await lease.release();
    await jobs.dispose();
  }
}

function emitRuntimeProgress(
  taskId: string,
  projectId: string,
  progress: WorkspaceOperationProgress
): void {
  const bootstrapProgress = workspaceRuntimeProgressToBootstrapProgress(progress);
  emitTaskProvisionProgress({
    taskId,
    projectId,
    step: bootstrapProgress.step,
    message: bootstrapProgress.message,
  });
}

export function workspaceRuntimeProgressToBootstrapProgress(
  progress: WorkspaceOperationProgress
): WorkspaceBootstrapProgress {
  const running = progress.stages.find((stage) => stage.status === 'running');
  const failed = progress.stages.find((stage) => stage.status === 'failed');
  const pending = progress.stages.find((stage) => stage.status === 'pending');
  const stage = running ?? failed ?? pending ?? progress.stages.at(-1);
  return {
    step: runtimeOperationToProvisionStep(progress.kind),
    message: stage?.progress?.message ?? stage?.label ?? 'Preparing workspace…',
    operation: progress,
  };
}

function runtimeOperationToProvisionStep(
  kind: WorkspaceOperationProgress['kind']
): WorkspaceBootstrapStep {
  switch (kind) {
    case 'provision':
    case 'convert':
    case 'reconcile':
    case 'deactivate':
    case 'teardown':
      return 'setting-up-workspace';
    case 'activate':
    case 'run-script':
      return 'initialising-workspace';
  }
}

function liveJobErrorToWorkspaceError(error: unknown): WorkspaceError {
  if (error instanceof LiveJobFailedError) {
    return error.error ?? { type: 'workspace-runtime-failed', message: 'Workspace runtime failed' };
  }
  if (error instanceof LiveJobCancelledError) {
    return { type: 'cancelled', message: 'Workspace runtime job was cancelled' };
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return error as WorkspaceError;
  }
  return {
    type: 'workspace-runtime-error',
    message: error instanceof Error ? error.message : String(error),
  };
}

export const workspaceBootstrapService = new WorkspaceBootstrapService(appDb);
