import { randomUUID } from 'node:crypto';
import { err, ok, type Result } from '@emdash/shared';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import type { MachineRef, RuntimeManager } from '@main/core/runtime/types';
import { createWorkspaceFactory } from '@main/core/workspaces/workspace-factory';
import {
  workspaceRegistry,
  type WorkspaceRegistry,
} from '@main/core/workspaces/workspace-registry';
import type { LoopSessionTarget } from '@shared/core/loops/loop-state';
import { FeatureSnapshotService, type FeatureSnapshotError } from './feature-snapshot-service';

export type CleanRoomProject = Pick<
  ProjectProvider,
  | 'projectId'
  | 'repoPath'
  | 'ctx'
  | 'defaultWorkspaceMachine'
  | 'defaultWorkspaceType'
  | 'worktreeService'
  | 'settings'
  | 'gitRepository'
  | 'gitRepositoryFetchService'
>;

type SnapshotOperations = Pick<FeatureSnapshotService, 'capture' | 'replay' | 'integrateFix'>;

export type CleanRoomWorkspaceServiceDependencies = {
  createWorkspaceFactory: typeof createWorkspaceFactory;
  workspaceRegistry: Pick<WorkspaceRegistry, 'acquire' | 'teardown'>;
  runtimeManager: Pick<RuntimeManager, 'acquire'>;
  createFeatureSnapshotService(ctx: IExecutionContext): SnapshotOperations;
  createId(): string;
};

export type CreateCleanRoomInput = {
  verificationRunId: string;
  attempt: number;
  task: { id: string; name: string };
  project: CleanRoomProject;
  featureTarget: LoopSessionTarget;
  baseCommit: string;
  expectedFeatureHead: string;
  requirePreview: boolean;
  signal?: AbortSignal;
  previewTimeoutMs?: number;
};

export type CleanRoomWorkspace = {
  verificationRunId: string;
  attempt: number;
  target: LoopSessionTarget;
  branchName: string;
  baseCommit: string;
  expectedFeatureHead: string;
  replayedThroughCommit: string;
};

export type CleanRoomWorkspaceError =
  | { type: 'unsupported-clean-room'; message: string }
  | { type: 'snapshot-failed'; cause: FeatureSnapshotError }
  | { type: 'worktree-create-failed'; message: string }
  | { type: 'replay-failed'; cause: FeatureSnapshotError }
  | { type: 'preserve-failed'; message: string }
  | { type: 'workspace-acquire-failed'; message: string }
  | { type: 'startup-failed'; message: string }
  | { type: 'cancelled'; message: string }
  | { type: 'cleanup-failed'; message: string }
  | { type: 'fix-integration-failed'; cause: FeatureSnapshotError };

const defaultDependencies: CleanRoomWorkspaceServiceDependencies = {
  createWorkspaceFactory,
  workspaceRegistry,
  runtimeManager,
  createFeatureSnapshotService: (ctx) => new FeatureSnapshotService(ctx),
  createId: () => randomUUID(),
};

function sameMachine(left: MachineRef, right: MachineRef): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'local' || (right.kind === 'ssh' && left.connectionId === right.connectionId))
  );
}

export class CleanRoomWorkspaceService {
  private readonly destroyed = new Set<string>();
  private readonly destroying = new Map<string, Promise<Result<void, CleanRoomWorkspaceError>>>();
  private readonly issuedIds = new Set<string>();
  private readonly cleanupProgress = new Map<
    string,
    { teardown: boolean; worktree: boolean; branch: boolean }
  >();

  constructor(private readonly deps: CleanRoomWorkspaceServiceDependencies = defaultDependencies) {}

  async preflight(
    input: Pick<CreateCleanRoomInput, 'project' | 'featureTarget'>
  ): Promise<Result<void, CleanRoomWorkspaceError>> {
    const { project, featureTarget } = input;
    const typeMatchesMachine =
      (project.defaultWorkspaceType.kind === 'local' &&
        project.defaultWorkspaceMachine.kind === 'local') ||
      (project.defaultWorkspaceType.kind === 'ssh' &&
        project.defaultWorkspaceMachine.kind === 'ssh' &&
        project.defaultWorkspaceType.connectionId === project.defaultWorkspaceMachine.connectionId);
    if (
      !typeMatchesMachine ||
      !sameMachine(project.defaultWorkspaceMachine, featureTarget.machine)
    ) {
      return err({
        type: 'unsupported-clean-room',
        message:
          'This workspace provider cannot create an immutable clean room on the task machine.',
      });
    }
    return ok();
  }

  async create(
    input: CreateCleanRoomInput
  ): Promise<Result<CleanRoomWorkspace, CleanRoomWorkspaceError>> {
    const supported = await this.preflight(input);
    if (!supported.success) return supported;
    if (input.signal?.aborted) return err(cancelledError());

    const snapshotService = this.deps.createFeatureSnapshotService(input.project.ctx);
    const snapshot = await snapshotService.capture({
      featurePath: input.featureTarget.path,
      baseCommit: input.baseCommit,
      expectedFeatureHead: input.expectedFeatureHead,
    });
    if (!snapshot.success) return err({ type: 'snapshot-failed', cause: snapshot.error });

    const suffix = this.allocateId();
    const workspaceId = `loop-verify-${suffix}`;
    const branchName = `emdash/loop-verify-${suffix}`;

    let created;
    try {
      created = await input.project.worktreeService.createWorktreeAtCommit(
        snapshot.data.baseCommit,
        branchName
      );
    } catch {
      return err({
        type: 'worktree-create-failed',
        message: 'Failed to create clean-room worktree.',
      });
    }
    if (!created.success) {
      return err({
        type: 'worktree-create-failed',
        message: 'Failed to create clean-room worktree.',
      });
    }
    const worktreePath = created.data;
    let acquisitionStarted = false;

    const failAfterCleanup = async (
      error: CleanRoomWorkspaceError
    ): Promise<Result<never, CleanRoomWorkspaceError>> => {
      const cleaned = await this.cleanupGenerated({
        workspaceId,
        worktreePath,
        branchName,
        project: input.project,
        teardownWorkspace: acquisitionStarted,
      });
      return cleaned.success ? err(error) : cleaned;
    };

    if (input.signal?.aborted) return failAfterCleanup(cancelledError());
    const replayed = await snapshotService.replay({
      verificationPath: worktreePath,
      snapshot: snapshot.data,
    });
    if (!replayed.success) {
      return failAfterCleanup({ type: 'replay-failed', cause: replayed.error });
    }

    if (input.signal?.aborted) return failAfterCleanup(cancelledError());
    let preserved;
    try {
      preserved = await input.project.worktreeService.copyPreservedFilesToWorktree(worktreePath);
    } catch {
      return failAfterCleanup({
        type: 'preserve-failed',
        message: 'Required clean-room preserved files could not be reproduced.',
      });
    }
    if (!preserved.success) {
      return failAfterCleanup({
        type: 'preserve-failed',
        message: 'Required clean-room preserved files could not be reproduced.',
      });
    }

    let acquired;
    try {
      acquisitionStarted = true;
      acquired = await this.deps.workspaceRegistry.acquire(
        workspaceId,
        input.project.projectId,
        this.deps.createWorkspaceFactory(workspaceId, input.project.defaultWorkspaceType, {
          task: input.task,
          workDir: worktreePath,
          projectId: input.project.projectId,
          projectPath: input.project.repoPath,
          workspaceRuntime: {
            machine: input.project.defaultWorkspaceMachine,
            manager: this.deps.runtimeManager,
          },
          settings: input.project.settings,
          logPrefix: 'CleanRoomWorkspaceService',
          gitRepository: input.project.gitRepository,
          gitRepositoryFetchService: input.project.gitRepositoryFetchService,
          strictStartup: {
            requirePreview: input.requirePreview,
            signal: input.signal,
            previewTimeoutMs: input.previewTimeoutMs,
          },
        })
      );
    } catch {
      return failAfterCleanup({
        type: 'workspace-acquire-failed',
        message: 'Failed to acquire the clean-room workspace.',
      });
    }

    let startup;
    try {
      startup = await acquired.workspace.lifecycleService.waitForRequiredStartup();
    } catch {
      return failAfterCleanup({
        type: 'startup-failed',
        message: 'Required workspace startup failed unexpectedly.',
      });
    }
    if (!startup.success) {
      return failAfterCleanup({
        type: 'startup-failed',
        message: startup.error.message,
      });
    }
    if (input.signal?.aborted) return failAfterCleanup(cancelledError());

    return ok({
      verificationRunId: input.verificationRunId,
      attempt: input.attempt,
      target: {
        workspaceId,
        path: worktreePath,
        machine: input.project.defaultWorkspaceMachine,
      },
      branchName,
      baseCommit: snapshot.data.baseCommit,
      expectedFeatureHead: snapshot.data.expectedFeatureHead,
      replayedThroughCommit: replayed.data.replayedThroughCommit,
    });
  }

  async integrateFix(input: {
    cleanRoom: CleanRoomWorkspace;
    featureTarget: LoopSessionTarget;
    expectedFeatureHead: string;
    fixCommit: string;
    project: CleanRoomProject;
  }): Promise<Result<{ featureHead: string }, CleanRoomWorkspaceError>> {
    const supported = await this.preflight({
      project: input.project,
      featureTarget: input.featureTarget,
    });
    if (!supported.success) return supported;
    if (this.destroyed.has(input.cleanRoom.target.workspaceId)) {
      return err({
        type: 'fix-integration-failed',
        cause: {
          type: 'fix-integration-failed',
          message: 'Clean room has already been destroyed.',
        },
      });
    }
    if (input.expectedFeatureHead !== input.cleanRoom.expectedFeatureHead) {
      return err({
        type: 'fix-integration-failed',
        cause: {
          type: 'feature-head-drift',
          expected: input.cleanRoom.expectedFeatureHead,
          actual: input.expectedFeatureHead,
        },
      });
    }
    const snapshotService = this.deps.createFeatureSnapshotService(input.project.ctx);
    const fixAttestation = await snapshotService.capture({
      featurePath: input.cleanRoom.target.path,
      baseCommit: input.expectedFeatureHead,
      expectedFeatureHead: input.fixCommit,
    });
    if (
      !fixAttestation.success ||
      fixAttestation.data.replayCommits.length !== 1 ||
      fixAttestation.data.replayCommits[0] !== input.fixCommit
    ) {
      return err({
        type: 'fix-integration-failed',
        cause: fixAttestation.success
          ? {
              type: 'fix-integration-failed',
              message: 'The clean-room fix must be exactly one checked-out commit.',
            }
          : fixAttestation.error,
      });
    }
    const result = await snapshotService.integrateFix({
      featurePath: input.featureTarget.path,
      expectedFeatureHead: input.expectedFeatureHead,
      fixCommit: input.fixCommit,
    });
    return result.success ? result : err({ type: 'fix-integration-failed', cause: result.error });
  }

  destroy(
    cleanRoom: CleanRoomWorkspace,
    project: CleanRoomProject
  ): Promise<Result<void, CleanRoomWorkspaceError>> {
    const key = cleanRoom.target.workspaceId;
    if (this.destroyed.has(key)) return Promise.resolve(ok());
    const inFlight = this.destroying.get(key);
    if (inFlight) return inFlight;
    const destroying = this.cleanupGenerated({
      workspaceId: key,
      worktreePath: cleanRoom.target.path,
      branchName: cleanRoom.branchName,
      project,
      teardownWorkspace: true,
    }).then((result) => {
      if (result.success) this.destroyed.add(key);
      this.destroying.delete(key);
      return result;
    });
    this.destroying.set(key, destroying);
    return destroying;
  }

  async recreate(
    cleanRoom: CleanRoomWorkspace,
    input: CreateCleanRoomInput
  ): Promise<Result<CleanRoomWorkspace, CleanRoomWorkspaceError>> {
    const destroyed = await this.destroy(cleanRoom, input.project);
    if (!destroyed.success) return destroyed;
    return this.create(input);
  }

  private async cleanupGenerated(input: {
    workspaceId: string;
    worktreePath: string;
    branchName: string;
    project: CleanRoomProject;
    teardownWorkspace: boolean;
  }): Promise<Result<void, CleanRoomWorkspaceError>> {
    const progress = this.cleanupProgress.get(input.workspaceId) ?? {
      teardown: !input.teardownWorkspace,
      worktree: false,
      branch: false,
    };
    this.cleanupProgress.set(input.workspaceId, progress);
    if (!progress.teardown && input.teardownWorkspace) {
      try {
        await this.deps.workspaceRegistry.teardown(input.workspaceId, 'terminate');
        progress.teardown = true;
      } catch {
        return cleanupFailure('workspace teardown');
      }
    }
    if (!progress.worktree) {
      const removed = await input.project.worktreeService.removeGeneratedWorktreeIfPresent(
        input.worktreePath
      );
      if (!removed.success) return cleanupFailure('worktree removal');
      progress.worktree = true;
    }
    if (!progress.branch) {
      try {
        const ref = `refs/heads/${input.branchName}`;
        const listed = await input.project.ctx.exec(
          'git',
          ['for-each-ref', '--format=%(refname)', ref],
          { timeout: 60_000 }
        );
        if (listed.stdout.trim() === ref) {
          await input.project.ctx.exec('git', ['branch', '--delete', '--force', input.branchName], {
            timeout: 60_000,
          });
        }
        progress.branch = true;
      } catch {
        return cleanupFailure('temporary branch removal');
      }
    }
    this.cleanupProgress.delete(input.workspaceId);
    return ok();
  }

  private allocateId(): string {
    const base = this.deps.createId().replace(/[^a-zA-Z0-9_-]/g, '-') || 'generated';
    let suffix = base;
    let ordinal = 1;
    while (this.issuedIds.has(suffix)) {
      ordinal += 1;
      suffix = `${base}-${ordinal}`;
    }
    this.issuedIds.add(suffix);
    return suffix;
  }
}

function cancelledError(): CleanRoomWorkspaceError {
  return { type: 'cancelled', message: 'Clean-room creation was cancelled.' };
}

function cleanupFailure(stage: string): Result<never, CleanRoomWorkspaceError> {
  return err({
    type: 'cleanup-failed',
    message: `Clean-room cleanup failed during ${stage}.`,
  });
}
