import path from 'node:path';
import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { ROOT_RELATIVE_PATH, type HostFileRef } from '@emdash/core/primitives/path/api';
import type { GitBranchRef } from '@emdash/core/runtimes/git/api';
import {
  compileBootstrapPlan,
  normalizeLegacyWorkspaceAutomation,
  workspaceContract,
  type ActivateWorkspaceInput,
  type BootstrapGitIntent,
  type BootstrapRepositoryInitialize,
  type ProvisionWorkspaceInput,
  type WorkspaceLifecyclePlans,
  type WorkspaceOperationProgress,
  type WorkspaceOperationResult,
  type WorkspaceError,
} from '@emdash/core/runtimes/workspace/api';
import { err, ok, type Result } from '@emdash/shared';
import { createLiveJobReplica, LiveJobCancelledError, LiveJobFailedError } from '@emdash/wire';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  WorkspaceBootstrapProgress,
  WorkspaceBootstrapStep,
  WorkspaceCloneProvisionResult,
} from '@core/features/workspaces/api';
import {
  activateWorkspaceParticipants,
  deactivateWorkspaceParticipants,
} from '@core/features/workspaces/node/lifecycle-participants';
import { workspaceIdentityService } from '@core/features/workspaces/node/workspace-identity-source';
import {
  hostFileRefFromNativePath,
  hostPathFromNative,
} from '@core/primitives/desktop-runtime/api';
import type { Task, ProvisionWorkspaceError } from '@core/primitives/tasks/api';
import type { GitSetup, WorkspaceLocation } from '@core/primitives/tasks/api';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api';
import type { WorkspaceProviderData } from '@core/primitives/workspaces/api';
import type { WorkspaceType } from '@core/primitives/workspaces/api';
import { tryAcquireWorkspaceRuntime } from '@core/services/workspace-runtime-access/node';
import { filesClientScope } from '@main/core/files/runtime-client';
import { projectManager } from '@main/core/projects/project-manager';
import type { ProjectProvider, TaskProvider } from '@main/core/projects/project-provider';
import { getEffectiveTaskSettings } from '@main/core/projects/settings/effective-task-settings';
import { buildTaskFromWorkspace, emitTaskProvisionProgress } from '@main/core/tasks/task-builder';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db as appDb, type AppDb } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { getWorkspaceRuntimeClient } from '@main/gateway/accessors';
import { log } from '@main/lib/logger';
import { deriveBranchName, resolveWorkspaceIntent } from '../tasks/resolve-workspace-intent';
import { provisionBYOITask } from './byoi/provision-byoi-task';
import { workspacePlacementResolver } from './placement/workspace-placement-resolver';
import { postActivationWorkflowNodes, triggerTaskScriptWorkflow } from './script-workflows';
import { getProvisionedWorkspaceBranch } from './workspace-branch';
import { computeWorkspaceKey } from './workspace-key';

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
   *   acquisition. Persisted worktree paths are probed through the runtimes so stale
   *   partial directories are repaired before acquisition.
   * - **BYOI workspaces**: delegates to `provisionBYOITask` which runs the
   *   provision script, connects SSH, and acquires the workspace.
   * - **Local/SSH workspaces**: compiles and executes a runtime lifecycle plan,
   *   persists the resolved path, then acquires.
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

    // Persisted worktree path: adopt it only when Git still registers the branch and
    // the runtime probe confirms that the path is a worktree. Otherwise, fall through
    // to the normal provision plan, which repairs a stale or missing checkout.
    if (workspaceRow.path && workspaceBranchName && isWorktreeWorkspace && !isByoi) {
      const registeredPath = await project.findTaskWorktree(workspaceBranchName);
      const runtimeWorkspace = registeredPath
        ? hostFileRefFromNativePath(registeredPath, connectionId)
        : null;
      const probe = runtimeWorkspace
        ? await project.workspace.reconcile({ workspace: runtimeWorkspace })
        : null;
      const resolvedPath =
        probe?.success && probe.data.topology?.kind === 'worktree' ? registeredPath : null;

      if (resolvedPath && runtimeWorkspace) {
        await this.persistPath(
          workspaceRow.id,
          resolvedPath,
          workspaceRow.type,
          connectionId,
          workspaceBranchName
        );

        return this._acquireAndBuild(
          workspaceRow.id,
          task,
          project,
          resolvedPath,
          { path: resolvedPath, workspace: runtimeWorkspace },
          workspaceBranchName,
          workspaceSourceBranch
        );
      }
    }

    // Fast path: non-worktree path already persisted and still exists on disk.
    if (workspaceRow.path && !isByoi && !isWorktreeWorkspace) {
      const exists = await project.files.client.fs.exists({
        root: hostPathFromNative(workspaceRow.path),
        relative: ROOT_RELATIVE_PATH,
      });
      if (exists.success && exists.data) {
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
      return this._provisionBYOI(project);
    }

    const intent = resolveWorkspaceIntent(taskRow, workspaceRow);
    if (!intent) {
      return err({ type: 'no-intent' });
    }

    const runtimePlanResult = await this.compileRuntimeWorkspacePlan(intent, project, connectionId);
    if (!runtimePlanResult.success) return runtimePlanResult;
    const runtimePlan = runtimePlanResult.data;

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

    const provisionResult = await runWorkspaceProvisionJob(task, project, {
      workspace: runtimePlan.workspace,
      lifecycle: runtimePlan.lifecycle,
    });
    if (!provisionResult.success) {
      return err({
        type: 'setup-failed',
        stepKind: provisionResult.error.stageId ?? 'workspace-runtime',
        stepErrorType: provisionResult.error.type,
        message: provisionResult.error.message,
      });
    }
    const resolvedPath = provisionResult.data.path ?? runtimePlan.path;
    await this.persistPath(
      workspaceRow.id,
      resolvedPath,
      workspaceRow.type,
      connectionId,
      intentBranchName
    );

    return this._acquireAndBuild(
      workspaceRow.id,
      task,
      project,
      resolvedPath,
      {
        ...runtimePlan,
        path: resolvedPath,
        workspace: hostFileRefFromNativePath(resolvedPath, connectionId),
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
    const [row] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!row?.workspaceId) return err({ type: 'missing-workspace' });

    const [wsRow] = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, row.workspaceId), isNull(workspaces.deletedAt)))
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
      const [existing] = await this.db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.key, key), isNull(workspaces.deletedAt)));
      if (existing && existing.id !== workspaceId) {
        return existing.id;
      }
    }

    await this.db
      .update(workspaces)
      .set({ path, key, branchName: branchName ?? null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)));
    workspaceIdentityService.invalidate(workspaceId);
    return workspaceId;
  }

  private async compileRuntimeWorkspacePlan(
    intent: { git: GitSetup; workspace: WorkspaceLocation },
    project: ProjectProvider,
    connectionId: string | undefined
  ): Promise<Result<RuntimeWorkspacePlan, ProvisionWorkspaceError>> {
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
      return ok({
        path: workspacePath,
        workspace: hostFileRefFromNativePath(workspacePath, connectionId),
        lifecycle: {
          ref: { kind: 'directory', path: workspacePath },
          context,
          setupPlan: { steps: [] },
        },
      });
    }

    const bootstrapIntent = toBootstrapGitIntent(intent.git);
    const { baseRemote } = await project.gitRepository.getConfiguredRemotes();
    const worktreePoolPath = await workspacePlacementResolver.resolveWorktreePool(project.project);
    if (!worktreePoolPath.success) {
      return err({
        type: 'setup-failed',
        stepKind: 'placement',
        stepErrorType: worktreePoolPath.error.type,
        message: worktreePoolPath.error.message,
      });
    }
    const compiled = compileBootstrapPlan(bootstrapIntent, {
      worktreePoolPath: worktreePoolPath.data,
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

    return ok({
      path: compiled.workspacePath,
      workspace: hostFileRefFromNativePath(compiled.workspacePath, connectionId),
      lifecycle: {
        ref,
        context: { ...context, worktreePoolPath: worktreePoolPath.data },
        setupPlan: compiled.plan,
      },
    });
  }

  async resolveLegacyAutomation(
    project: ProjectProvider,
    workDir: string
  ): Promise<ActivateWorkspaceInput['automation']> {
    const projectSettings = await project.settings.get();
    if (!projectSettings) return undefined;

    const taskFiles = filesClientScope(project.files.client, workDir);
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

    const automation = await this.resolveLegacyAutomation(project, workDir);
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

    workspaceIdentityService.invalidate(workspaceId);
    const accessResult = await tryAcquireWorkspaceRuntime(workspaceId);
    if (!accessResult.success) {
      await runWorkspaceDeactivateJob(task, project, runtimePlan.workspace, automation).catch(
        () => {}
      );
      return err(accessResult.error);
    }
    const access = accessResult.data;
    if (!access) {
      await runWorkspaceDeactivateJob(task, project, runtimePlan.workspace, automation).catch(
        () => {}
      );
      return err({
        type: 'setup-failed',
        stepKind: 'workspace-identity',
        stepErrorType: 'not-found',
        message: `Workspace ${workspaceId} was not found after provisioning`,
      });
    }
    await activateWorkspaceParticipants(access.identity);

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
        {
          id: workspaceId,
          host: access.identity.host,
          path: workDir,
          configPath: project.configPathForDirectory(workDir),
          files: access.files,
          settings: project.settings,
        },
        type,
        project.projectId,
        project.repoPath,
        project.settings,
        workspaceBranchName,
        workspaceSourceBranch
      );
      if (!buildResult.success) {
        await runWorkspaceDeactivateJob(task, project, runtimePlan.workspace, automation).catch(
          () => {}
        );
        return err(buildResult.error);
      }
      buildSucceeded = true;
      return ok({
        path: workDir,
        workspaceId,
        runtimeWorkspace: runtimePlan.workspace,
        sshConnectionId: type.kind === 'ssh' ? type.connectionId : undefined,
        worktreeGitDir: undefined,
        taskProvider: buildResult.data.taskProvider,
        postActivationAutomation: automation,
      });
    } catch (e) {
      await runWorkspaceDeactivateJob(task, project, runtimePlan.workspace, automation).catch(
        () => {}
      );
      return err({
        type: 'setup-failed',
        stepKind: 'build-providers',
        stepErrorType: 'error',
        message: String(e),
      });
    } finally {
      await access.release();
      if (!buildSucceeded) await deactivateWorkspaceParticipants(access.identity);
    }
  }

  /**
   * Provisions a BYOI workspace by delegating to `provisionBYOITask`.
   */
  private async _provisionBYOI(
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
        host:
          project.defaultWorkspaceType.kind === 'ssh'
            ? hostRef('remote', project.defaultWorkspaceType.connectionId)
            : LOCAL_HOST_REF,
      });
      if (!result.success) return result;
      return ok({
        ...result.data,
        runtimeWorkspace: hostFileRefFromNativePath(result.data.path, result.data.sshConnectionId),
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
  const jobs = createLiveJobReplica(workspaceContract.provision, project.workspace.provision);
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
  const workspaceRuntimeClient = await getWorkspaceRuntimeClient();
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
  const jobs = createLiveJobReplica(workspaceContract.activate, project.workspace.activate);
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
  const nodes = postActivationWorkflowNodes(automation);
  if (nodes.length === 0) return;

  void triggerTaskScriptWorkflow({
    task,
    project,
    workspaceId: result.workspaceId,
    workspace: result.runtimeWorkspace,
    cwd: result.path,
    kind: 'post-activation',
    shellSetup: automation.shellSetup,
    nodes,
  }).catch((error: unknown) => {
    log.warn('Workspace post-activation scripts failed', {
      taskId: task.id,
      workspaceId: result.workspaceId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function runWorkspaceDeactivateJob(
  task: Task,
  project: ProjectProvider,
  workspace: ActivateWorkspaceInput['workspace'],
  automation?: ActivateWorkspaceInput['automation']
): Promise<void> {
  const jobs = createLiveJobReplica(workspaceContract.deactivate, project.workspace.deactivate);
  const lease = await jobs.start({
    workspace,
    consumerId: task.id,
    strategy: 'stop',
    automation,
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
    operation: bootstrapProgress.operation,
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
    case 'clean-artifacts':
      return 'setting-up-workspace';
    case 'activate':
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
