import { err, ok, type Result } from '@emdash/shared';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import type {
  CopyPreservedFilesError,
  CreateWorktreeAtCommitError,
} from '@main/core/projects/worktrees/worktree-service';
import type { MachineRef, RuntimeManager } from '@main/core/runtime/types';
import type { createWorkspaceFactory } from '@main/core/workspaces/workspace-factory';
import type { WorkspaceRegistry } from '@main/core/workspaces/workspace-registry';
import type { LoopSessionTarget } from '@shared/core/loops/loop-state';
import {
  clonePendingCleanup,
  parseCleanRoomPendingCleanup,
  type CleanRoomCleanupJournal,
  type CleanRoomPendingCleanup,
} from './cleanup-journal';
import type { FeatureSnapshotError, FeatureSnapshotService } from './feature-snapshot-service';

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

export type CleanRoomSourceCapability =
  | {
      kind: 'immutable-same-machine-git-worktree';
      projectId: string;
      machine: MachineRef;
    }
  | { kind: 'unsupported'; provider: string };

type SnapshotOperations = Pick<FeatureSnapshotService, 'capture' | 'replay' | 'integrateFix'>;

export type CleanRoomWorkspaceServiceDependencies = {
  createWorkspaceFactory: typeof createWorkspaceFactory;
  workspaceRegistry: Pick<WorkspaceRegistry, 'acquire' | 'teardown'>;
  runtimeManager: Pick<RuntimeManager, 'acquire'>;
  cleanupJournal: CleanRoomCleanupJournal;
  /**
   * Trusted provider boundary. Implementations must resolve the actual feature workspace by
   * workspaceId and bind its provider, path, and machine; caller data or default workspace type
   * alone is not authority.
   */
  resolveSourceCapability(
    project: CleanRoomProject,
    featureTarget: LoopSessionTarget
  ): Promise<CleanRoomSourceCapability>;
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
  timeoutMs?: number;
};

export type CleanRoomWorkspace = {
  projectId: string;
  cleanupId: string;
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
  | { type: 'deadline-exceeded'; message: string }
  | { type: 'cleanup-journal-failed'; message: string }
  | { type: 'invalid-clean-room-identity'; message: string }
  | {
      type: 'cleanup-failed';
      message: string;
      pendingCleanup?: CleanRoomPendingCleanup;
    }
  | { type: 'fix-integration-failed'; cause: FeatureSnapshotError };

type IssuedCleanRoom = {
  workspace: CleanRoomWorkspace;
  featureTarget: LoopSessionTarget;
};

type CleanRoomOperationControl = {
  signal?: AbortSignal;
  deadlineAt: number;
};

type CleanRoomStopFailure = Extract<
  CleanRoomWorkspaceError,
  { type: 'cancelled' | 'deadline-exceeded' }
>;

const CLEAN_ROOM_TIMEOUT_MS = 10 * 60_000;
const MAX_CLEAN_ROOM_TIMEOUT_MS = 2_147_483_647;
const FULL_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

function sameMachine(left: MachineRef, right: MachineRef): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === 'local' || (right.kind === 'ssh' && left.connectionId === right.connectionId))
  );
}

export class CleanRoomWorkspaceService {
  private readonly cleanupAuthorityPrerequisites = new Map<string, Set<Promise<unknown>>>();
  private readonly cleanupResourcePrerequisites = new Map<string, Set<Promise<unknown>>>();
  private readonly destroyed = new Set<string>();
  private readonly destroying = new Map<string, Promise<Result<void, CleanRoomWorkspaceError>>>();
  private readonly issuedIds = new Set<string>();
  private readonly issuedWorkspaces = new Map<string, IssuedCleanRoom>();

  constructor(private readonly deps: CleanRoomWorkspaceServiceDependencies) {}

  async preflight(
    input: Pick<CreateCleanRoomInput, 'project' | 'featureTarget'>,
    control?: CleanRoomOperationControl
  ): Promise<Result<void, CleanRoomWorkspaceError>> {
    const { project, featureTarget } = input;
    let sourceCapability: CleanRoomSourceCapability;
    try {
      const operation = this.deps.resolveSourceCapability(project, featureTarget);
      sourceCapability = control
        ? await awaitWithCleanRoomControl(operation, control)
        : await operation;
    } catch (cause) {
      const stopped = stoppedCleanRoomFailure(cause, control);
      if (stopped) return err(stopped);
      return err(unsupportedCleanRoomError());
    }
    const typeMatchesMachine =
      (project.defaultWorkspaceType.kind === 'local' &&
        project.defaultWorkspaceMachine.kind === 'local') ||
      (project.defaultWorkspaceType.kind === 'ssh' &&
        project.defaultWorkspaceMachine.kind === 'ssh' &&
        project.defaultWorkspaceType.connectionId === project.defaultWorkspaceMachine.connectionId);
    if (
      sourceCapability.kind !== 'immutable-same-machine-git-worktree' ||
      sourceCapability.projectId !== project.projectId ||
      !sameMachine(sourceCapability.machine, featureTarget.machine) ||
      !typeMatchesMachine ||
      !sameMachine(project.defaultWorkspaceMachine, featureTarget.machine)
    ) {
      return err(unsupportedCleanRoomError());
    }
    return ok();
  }

  async create(
    input: CreateCleanRoomInput
  ): Promise<Result<CleanRoomWorkspace, CleanRoomWorkspaceError>> {
    const deadlineAt = cleanRoomDeadlineAt(input.timeoutMs);
    const control = { signal: input.signal, deadlineAt } satisfies CleanRoomOperationControl;
    const stopped = cleanRoomOperationFailure(input.signal, deadlineAt);
    if (stopped) return err(stopped);
    const supported = await this.preflight(input, control);
    if (!supported.success) return supported;

    const snapshotService = this.deps.createFeatureSnapshotService(input.project.ctx);
    let snapshot;
    try {
      snapshot = await awaitWithCleanRoomControl(
        snapshotService.capture({
          featurePath: input.featureTarget.path,
          baseCommit: input.baseCommit,
          expectedFeatureHead: input.expectedFeatureHead,
          signal: input.signal,
          deadlineAt,
        }),
        control
      );
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) return err(stoppedFailure);
      return err({
        type: 'snapshot-failed',
        cause: dependencyFeatureFailure('capture-feature-snapshot'),
      });
    }
    if (!snapshot.success) {
      return err(mapFeatureFailure(snapshot.error, 'snapshot-failed'));
    }
    const stoppedAfterSnapshot = cleanRoomOperationFailure(input.signal, deadlineAt);
    if (stoppedAfterSnapshot) return err(stoppedAfterSnapshot);

    const suffix = this.allocateId();
    const workspaceId = `loop-verify-${suffix}`;
    const cleanupId = `cleanup-${workspaceId}`;
    const branchName = `emdash/${workspaceId}`;

    let resolvedTarget;
    try {
      resolvedTarget = await awaitWithCleanRoomControl(
        input.project.worktreeService.resolveGeneratedWorktreePath(branchName),
        control
      );
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) return err(stoppedFailure);
      return err(worktreeCreateFailure());
    }
    if (!resolvedTarget.success) return err(worktreeCreateFailure());
    const worktreePath = resolvedTarget.data;
    let pendingCleanup: CleanRoomPendingCleanup = {
      version: '1',
      cleanupId,
      verificationRunId: input.verificationRunId,
      attempt: input.attempt,
      projectId: input.project.projectId,
      workspaceId,
      target: {
        path: worktreePath,
        machine: { ...input.project.defaultWorkspaceMachine },
      },
      featureTarget: cloneTarget(input.featureTarget),
      branchName,
      baseCommit: snapshot.data.baseCommit,
      expectedFeatureHead: snapshot.data.expectedFeatureHead,
      worktreeOwnership: 'intent',
      teardownRequired: false,
      branchHead: snapshot.data.baseCommit,
      completed: { teardown: false, worktree: false, branch: false },
      revision: 0,
    };

    const failAfterCleanup = async (
      failure: CleanRoomWorkspaceError
    ): Promise<Result<never, CleanRoomWorkspaceError>> => {
      const cleanup = this.retryPendingCleanup(cleanupId, input.project);
      try {
        const cleaned = await awaitWithCleanRoomControl(cleanup, control);
        return cleaned.success ? err(failure) : cleaned;
      } catch (cause) {
        const stoppedFailure = stoppedCleanRoomFailure(cause, control);
        return err(stoppedFailure ?? failure);
      }
    };

    const initialJournalOperation = this.trackCleanupPrerequisite(
      cleanupId,
      this.persistCreationCheckpoint(pendingCleanup, null),
      'authority'
    );
    let journaled;
    try {
      journaled = await awaitWithCleanRoomControl(initialJournalOperation, control);
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) {
        void initialJournalOperation.then((settled) => {
          if (settled.success) void this.discardCreationIntentIfExact(settled.data);
        });
        return err(stoppedFailure);
      }
      return err({
        type: 'cleanup-journal-failed',
        message: 'Clean-room cleanup state could not be persisted.',
      });
    }
    if (!journaled.success) return journaled;
    pendingCleanup = journaled.data;

    let rawCreateWorktreeOperation: ReturnType<
      CleanRoomProject['worktreeService']['createWorktreeAtCommit']
    >;
    try {
      rawCreateWorktreeOperation = input.project.worktreeService.createWorktreeAtCommit(
        snapshot.data.baseCommit,
        branchName,
        {
          signal: input.signal,
          deadlineAt,
          expectedTargetPath: worktreePath,
        }
      );
    } catch {
      return cleanupFailureWithRecord('worktree creation dependency settlement', pendingCleanup);
    }
    const createWorktreeOperation = this.trackCleanupPrerequisite(
      cleanupId,
      rawCreateWorktreeOperation,
      'resource'
    );
    let created;
    try {
      created = await awaitWithCleanRoomControl(createWorktreeOperation, control);
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) {
        void createWorktreeOperation.then(
          (settled) => {
            if (!settled.success && settled.error.type !== 'worktree-rollback-incomplete') {
              void this.discardCreationIntentIfExact(pendingCleanup);
              return;
            }
            void this.retryPendingCleanup(cleanupId, input.project);
          },
          () => {
            void this.retryPendingCleanup(cleanupId, input.project);
          }
        );
        return err(stoppedFailure);
      }
      return failAfterCleanup(worktreeCreateFailure());
    }
    if (!created.success) {
      const operationFailure = mapWorktreeOperationFailure(created.error);
      if (created.error.type !== 'worktree-rollback-incomplete') {
        let discarded;
        try {
          discarded = await this.awaitCleanupPrerequisite(
            cleanupId,
            this.discardCreationIntent(pendingCleanup),
            control,
            'authority'
          );
        } catch (cause) {
          const stoppedFailure = stoppedCleanRoomFailure(cause, control);
          return err(stoppedFailure ?? worktreeCreateFailure());
        }
        if (!discarded.success) return discarded;
        return err(operationFailure ?? worktreeCreateFailure());
      }
      return failAfterCleanup(operationFailure ?? worktreeCreateFailure());
    }
    if (created.data !== worktreePath) return failAfterCleanup(worktreeCreateFailure());

    let expectedJournalRevision = pendingCleanup.revision;
    pendingCleanup = {
      ...pendingCleanup,
      worktreeOwnership: 'attested',
      revision: expectedJournalRevision + 1,
    };
    let createdJournaled;
    try {
      createdJournaled = await this.awaitCleanupPrerequisite(
        cleanupId,
        this.persistCreationCheckpoint(pendingCleanup, expectedJournalRevision),
        control,
        'authority'
      );
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      return failAfterCleanup(stoppedFailure ?? journalCheckpointFailure());
    }
    if (!createdJournaled.success) return failAfterCleanup(createdJournaled.error);
    pendingCleanup = createdJournaled.data;

    const stoppedBeforeReplay = cleanRoomOperationFailure(input.signal, deadlineAt);
    if (stoppedBeforeReplay) return failAfterCleanup(stoppedBeforeReplay);
    let replayed;
    try {
      replayed = await this.awaitCleanupPrerequisite(
        cleanupId,
        snapshotService.replay({
          verificationPath: worktreePath,
          snapshot: snapshot.data,
          signal: input.signal,
          deadlineAt,
        }),
        control
      );
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) return failAfterCleanup(stoppedFailure);
      return failAfterCleanup({
        type: 'replay-failed',
        cause: dependencyFeatureFailure('replay-feature-snapshot'),
      });
    }
    if (!replayed.success) {
      return failAfterCleanup(mapFeatureFailure(replayed.error, 'replay-failed'));
    }

    expectedJournalRevision = pendingCleanup.revision;
    pendingCleanup = {
      ...pendingCleanup,
      branchHead: replayed.data.replayedThroughCommit,
      revision: expectedJournalRevision + 1,
    };
    let replayJournaled;
    try {
      replayJournaled = await this.awaitCleanupPrerequisite(
        cleanupId,
        this.persistCreationCheckpoint(pendingCleanup, expectedJournalRevision),
        control,
        'authority'
      );
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      return failAfterCleanup(stoppedFailure ?? journalCheckpointFailure());
    }
    if (!replayJournaled.success) return failAfterCleanup(replayJournaled.error);
    pendingCleanup = replayJournaled.data;

    const stoppedBeforePreserve = cleanRoomOperationFailure(input.signal, deadlineAt);
    if (stoppedBeforePreserve) return failAfterCleanup(stoppedBeforePreserve);
    let preserved;
    try {
      preserved = await this.awaitCleanupPrerequisite(
        cleanupId,
        input.project.worktreeService.copyPreservedFilesToWorktree(worktreePath, {
          strict: true,
          generatedBranchName: branchName,
          sourcePath: input.featureTarget.path,
          signal: input.signal,
          deadlineAt,
        }),
        control
      );
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) return failAfterCleanup(stoppedFailure);
      return failAfterCleanup({
        type: 'preserve-failed',
        message: 'Required clean-room preserved files could not be reproduced.',
      });
    }
    if (!preserved.success) {
      const operationFailure = mapPreserveOperationFailure(preserved.error);
      if (operationFailure) return failAfterCleanup(operationFailure);
      return failAfterCleanup({
        type: 'preserve-failed',
        message: 'Required clean-room preserved files could not be reproduced.',
      });
    }

    expectedJournalRevision = pendingCleanup.revision;
    pendingCleanup = {
      ...pendingCleanup,
      teardownRequired: true,
      revision: expectedJournalRevision + 1,
    };
    let acquisitionJournaled;
    try {
      acquisitionJournaled = await this.awaitCleanupPrerequisite(
        cleanupId,
        this.persistCreationCheckpoint(pendingCleanup, expectedJournalRevision),
        control,
        'authority'
      );
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      return failAfterCleanup(stoppedFailure ?? journalCheckpointFailure());
    }
    if (!acquisitionJournaled.success) return failAfterCleanup(acquisitionJournaled.error);
    pendingCleanup = acquisitionJournaled.data;

    let acquired;
    try {
      const factory = this.deps.createWorkspaceFactory(
        workspaceId,
        input.project.defaultWorkspaceType,
        {
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
            deadlineAt,
            previewTimeoutMs: input.previewTimeoutMs,
          },
        }
      );
      acquired = await this.awaitCleanupPrerequisite(
        cleanupId,
        this.deps.workspaceRegistry.acquire(workspaceId, input.project.projectId, factory, control),
        control
      );
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) return failAfterCleanup(stoppedFailure);
      return failAfterCleanup({
        type: 'workspace-acquire-failed',
        message: 'Failed to acquire the clean-room workspace.',
      });
    }

    let startup;
    try {
      startup = await this.awaitCleanupPrerequisite(
        cleanupId,
        acquired.workspace.lifecycleService.waitForRequiredStartup(),
        control
      );
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) return failAfterCleanup(stoppedFailure);
      return failAfterCleanup({
        type: 'startup-failed',
        message: 'Required workspace startup failed unexpectedly.',
      });
    }
    if (!startup.success) {
      const stoppedFailure = cleanRoomOperationFailure(input.signal, deadlineAt);
      if (stoppedFailure) return failAfterCleanup(stoppedFailure);
      return failAfterCleanup({
        type: 'startup-failed',
        message: startup.error.message,
      });
    }
    const stoppedAfterStartup = cleanRoomOperationFailure(input.signal, deadlineAt);
    if (stoppedAfterStartup) return failAfterCleanup(stoppedAfterStartup);

    const cleanRoom: CleanRoomWorkspace = {
      projectId: input.project.projectId,
      cleanupId,
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
    };
    this.issuedWorkspaces.set(cleanupId, {
      workspace: cloneWorkspace(cleanRoom),
      featureTarget: cloneTarget(input.featureTarget),
    });
    return ok(cleanRoom);
  }

  async integrateFix(input: {
    cleanRoom: CleanRoomWorkspace;
    featureTarget: LoopSessionTarget;
    expectedFeatureHead: string;
    fixCommit: string;
    project: CleanRoomProject;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<Result<{ featureHead: string }, CleanRoomWorkspaceError>> {
    const deadlineAt = cleanRoomDeadlineAt(input.timeoutMs);
    const control = { signal: input.signal, deadlineAt } satisfies CleanRoomOperationControl;
    const stopped = cleanRoomOperationFailure(input.signal, deadlineAt);
    if (stopped) return err(stopped);
    const identity = await this.validateIssuedWorkspace(
      input.cleanRoom,
      input.featureTarget,
      input.project,
      true,
      control
    );
    if (!identity.success) return identity;
    if (
      this.destroyed.has(input.cleanRoom.cleanupId) ||
      this.destroyed.has(input.cleanRoom.target.workspaceId)
    ) {
      return err({
        type: 'fix-integration-failed',
        cause: {
          type: 'fix-integration-failed',
          message: 'Clean room has already been destroyed.',
        },
      });
    }
    if (input.expectedFeatureHead !== identity.data.workspace.expectedFeatureHead) {
      return err({
        type: 'fix-integration-failed',
        cause: {
          type: 'feature-head-drift',
          expected: identity.data.workspace.expectedFeatureHead,
          actual: input.expectedFeatureHead,
        },
      });
    }
    const snapshotService = this.deps.createFeatureSnapshotService(input.project.ctx);
    let fixAttestation;
    try {
      fixAttestation = await this.awaitCleanupPrerequisite(
        input.cleanRoom.cleanupId,
        snapshotService.capture({
          featurePath: identity.data.workspace.target.path,
          baseCommit: input.expectedFeatureHead,
          expectedFeatureHead: input.fixCommit,
          signal: input.signal,
          deadlineAt,
        }),
        control
      );
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) return err(stoppedFailure);
      return err({
        type: 'fix-integration-failed',
        cause: dependencyFeatureFailure('attest-clean-room-fix'),
      });
    }
    if (!fixAttestation.success) {
      const operationFailure = mapFeatureOperationFailure(fixAttestation.error);
      return operationFailure
        ? err(operationFailure)
        : err({ type: 'fix-integration-failed', cause: fixAttestation.error });
    }
    if (
      fixAttestation.data.replayCommits.length !== 1 ||
      fixAttestation.data.replayCommits[0] !== input.fixCommit
    ) {
      return err({
        type: 'fix-integration-failed',
        cause: {
          type: 'fix-integration-failed',
          message: 'The clean-room fix must be exactly one checked-out commit.',
        },
      });
    }
    const fixCheckpointed = await this.checkpointCleanupBranchHead(
      input.cleanRoom.cleanupId,
      input.fixCommit,
      input.project,
      control
    );
    if (!fixCheckpointed.success) return fixCheckpointed;
    let result;
    try {
      const integration = this.trackCleanupPrerequisite(
        input.cleanRoom.cleanupId,
        snapshotService.integrateFix({
          featurePath: identity.data.featureTarget.path,
          expectedFeatureHead: input.expectedFeatureHead,
          fixCommit: input.fixCommit,
          signal: input.signal,
          deadlineAt,
        }),
        'resource'
      );
      result = await awaitWithCleanRoomQuiescentMutationControl(integration, control);
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) return err(stoppedFailure);
      return err({
        type: 'fix-integration-failed',
        cause: dependencyFeatureFailure('integrate-clean-room-fix'),
      });
    }
    if (result.success) return result;
    const operationFailure = mapFeatureOperationFailure(result.error);
    return operationFailure
      ? err(operationFailure)
      : err({ type: 'fix-integration-failed', cause: result.error });
  }

  private async validateIssuedWorkspace(
    cleanRoom: CleanRoomWorkspace,
    featureTarget: LoopSessionTarget,
    project: CleanRoomProject,
    requireWorktreeAttestation: boolean,
    control?: CleanRoomOperationControl
  ): Promise<Result<IssuedCleanRoom, CleanRoomWorkspaceError>> {
    const issued = this.issuedWorkspaces.get(cleanRoom.cleanupId);
    if (
      !issued ||
      !sameWorkspaceIdentity(cleanRoom, issued.workspace) ||
      !sameTargetIdentity(featureTarget, issued.featureTarget) ||
      cleanRoom.projectId !== project.projectId ||
      cleanRoom.branchName !== `emdash/${cleanRoom.target.workspaceId}` ||
      cleanRoom.cleanupId !== `cleanup-${cleanRoom.target.workspaceId}` ||
      !sameMachine(cleanRoom.target.machine, project.defaultWorkspaceMachine)
    ) {
      return err(invalidIdentityError());
    }

    let pending: CleanRoomPendingCleanup | undefined;
    try {
      const operation = this.deps.cleanupJournal.load(cleanRoom.cleanupId);
      pending = control ? await awaitWithCleanRoomControl(operation, control) : await operation;
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) return err(stoppedFailure);
      return err(invalidIdentityError());
    }
    if (
      !pending ||
      pending.projectId !== cleanRoom.projectId ||
      pending.verificationRunId !== cleanRoom.verificationRunId ||
      pending.attempt !== cleanRoom.attempt ||
      pending.workspaceId !== cleanRoom.target.workspaceId ||
      pending.target.path !== cleanRoom.target.path ||
      !sameMachine(pending.target.machine, cleanRoom.target.machine) ||
      !sameTargetIdentity(pending.featureTarget, featureTarget) ||
      pending.branchName !== cleanRoom.branchName ||
      pending.baseCommit !== cleanRoom.baseCommit ||
      pending.expectedFeatureHead !== cleanRoom.expectedFeatureHead
    ) {
      return err(invalidIdentityError());
    }

    try {
      const canonicalOperation = project.worktreeService.resolveGeneratedWorktreePath(
        cleanRoom.branchName
      );
      const canonical = control
        ? await awaitWithCleanRoomControl(canonicalOperation, control)
        : await canonicalOperation;
      if (!canonical.success || canonical.data !== cleanRoom.target.path) {
        return err(invalidIdentityError());
      }
      if (requireWorktreeAttestation) {
        const attestationOperation = project.worktreeService.attestGeneratedWorktree(
          cleanRoom.target.path,
          cleanRoom.branchName
        );
        const attested = control
          ? await awaitWithCleanRoomControl(attestationOperation, control)
          : await attestationOperation;
        if (!attested.success) return err(invalidIdentityError());
      }
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) return err(stoppedFailure);
      return err(invalidIdentityError());
    }
    return ok({
      workspace: cloneWorkspace(issued.workspace),
      featureTarget: cloneTarget(issued.featureTarget),
    });
  }

  private async checkpointCleanupBranchHead(
    cleanupId: string,
    branchHead: string,
    project: CleanRoomProject,
    control?: CleanRoomOperationControl
  ): Promise<Result<void, CleanRoomWorkspaceError>> {
    let record: CleanRoomPendingCleanup | undefined;
    try {
      const operation = this.deps.cleanupJournal.load(cleanupId);
      record = control ? await awaitWithCleanRoomControl(operation, control) : await operation;
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      if (stoppedFailure) return err(stoppedFailure);
      return err({
        type: 'cleanup-journal-failed',
        message: 'Clean-room cleanup state could not be loaded.',
      });
    }
    if (!record) return err(invalidIdentityError());
    const validated = await validatePendingCleanup(record, project, control);
    if (!validated.success) return validated;
    record = validated.data;
    if (record.worktreeOwnership !== 'attested') return err(invalidIdentityError());
    if (record.branchHead === branchHead) return ok();
    if (record.branchHead !== record.expectedFeatureHead) return err(invalidIdentityError());
    const expectedRevision = record.revision;
    record = { ...record, branchHead, revision: expectedRevision + 1 };
    const operation = this.trackCleanupPrerequisite(
      cleanupId,
      this.persistPendingCleanup(record, expectedRevision),
      'authority'
    );
    if (!control) return operation;
    try {
      return await awaitWithCleanRoomControl(operation, control);
    } catch (cause) {
      const stoppedFailure = stoppedCleanRoomFailure(cause, control);
      return stoppedFailure ? err(stoppedFailure) : err(journalCheckpointFailure());
    }
  }

  async adoptPendingCleanup(
    candidate: unknown,
    project: CleanRoomProject
  ): Promise<Result<{ cleanupId: string }, CleanRoomWorkspaceError>> {
    const parsed = parseCleanRoomPendingCleanup(candidate);
    if (!parsed.success) return err(invalidIdentityError());
    const record = parsed.data;

    let existing: CleanRoomPendingCleanup | undefined;
    try {
      existing = await this.deps.cleanupJournal.load(record.cleanupId);
    } catch {
      return err({
        type: 'cleanup-journal-failed',
        message: 'Clean-room cleanup state could not be loaded.',
      });
    }
    if (!existing) return err(invalidIdentityError());
    const parsedExisting = parseCleanRoomPendingCleanup(existing);
    if (!parsedExisting.success || JSON.stringify(parsedExisting.data) !== JSON.stringify(record)) {
      return err(invalidIdentityError());
    }
    const validated = await validatePendingCleanup(parsedExisting.data, project);
    return validated.success ? ok({ cleanupId: validated.data.cleanupId }) : validated;
  }

  async recoverPendingCleanups(
    project: CleanRoomProject
  ): Promise<Result<{ cleanupIds: string[] }, CleanRoomWorkspaceError>> {
    let records: CleanRoomPendingCleanup[];
    try {
      records = await this.deps.cleanupJournal.list();
    } catch {
      return err({
        type: 'cleanup-journal-failed',
        message: 'Clean-room cleanup state could not be enumerated.',
      });
    }
    const projectCleanupIds = new Set<string>();
    for (const candidate of records) {
      const parsed = parseCleanRoomPendingCleanup(candidate);
      if (!parsed.success) return err(invalidIdentityError());
      if (parsed.data.projectId !== project.projectId) continue;
      projectCleanupIds.add(parsed.data.cleanupId);
    }
    const cleanupIds = [...projectCleanupIds].sort();
    for (const cleanupId of cleanupIds) {
      const cleaned = await this.retryPendingCleanup(cleanupId, project);
      if (!cleaned.success) return cleaned;
    }
    return ok({ cleanupIds });
  }

  async destroy(
    cleanRoom: CleanRoomWorkspace,
    project: CleanRoomProject
  ): Promise<Result<void, CleanRoomWorkspaceError>> {
    if (this.destroyed.has(cleanRoom.cleanupId)) return ok();
    const issued = this.issuedWorkspaces.get(cleanRoom.cleanupId);
    if (!issued) return err(invalidIdentityError());
    const identity = await this.validateIssuedWorkspace(
      cleanRoom,
      issued.featureTarget,
      project,
      false
    );
    if (!identity.success) return identity;
    const result = await this.retryPendingCleanup(cleanRoom.cleanupId, project);
    if (result.success) this.issuedWorkspaces.delete(cleanRoom.cleanupId);
    return result;
  }

  private trackCleanupPrerequisite<T>(
    cleanupId: string,
    operation: Promise<T>,
    kind: 'authority' | 'resource'
  ): Promise<T> {
    const prerequisites =
      kind === 'authority' ? this.cleanupAuthorityPrerequisites : this.cleanupResourcePrerequisites;
    let pending = prerequisites.get(cleanupId);
    if (!pending) {
      pending = new Set();
      prerequisites.set(cleanupId, pending);
    }
    pending.add(operation);
    const remove = (): void => {
      pending!.delete(operation);
      if (pending!.size === 0 && prerequisites.get(cleanupId) === pending) {
        prerequisites.delete(cleanupId);
      }
    };
    void operation.then(remove, remove);
    return operation;
  }

  private awaitCleanupPrerequisite<T>(
    cleanupId: string,
    operation: Promise<T>,
    control: CleanRoomOperationControl,
    kind: 'authority' | 'resource' = 'resource'
  ): Promise<T> {
    return awaitWithCleanRoomControl(
      this.trackCleanupPrerequisite(cleanupId, operation, kind),
      control
    );
  }

  private async waitForCleanupPrerequisites(
    cleanupId: string,
    kind: 'authority' | 'resource'
  ): Promise<void> {
    const prerequisites =
      kind === 'authority' ? this.cleanupAuthorityPrerequisites : this.cleanupResourcePrerequisites;
    while (true) {
      const pending = Array.from(prerequisites.get(cleanupId) ?? []);
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
    }
  }

  retryPendingCleanup(
    cleanupId: string,
    project: CleanRoomProject
  ): Promise<Result<void, CleanRoomWorkspaceError>> {
    if (this.destroyed.has(cleanupId)) return Promise.resolve(ok());
    if (!/^cleanup-loop-verify-[a-zA-Z0-9_-]+$/.test(cleanupId) || cleanupId.length > 180) {
      return Promise.resolve(err(invalidIdentityError()));
    }
    const inFlight = this.destroying.get(cleanupId);
    if (inFlight) return inFlight;
    const operation = this.runPendingCleanup(cleanupId, project)
      .catch((): Result<void, CleanRoomWorkspaceError> => {
        return err({
          type: 'cleanup-journal-failed',
          message: 'Clean-room cleanup failed unexpectedly.',
        });
      })
      .then((result) => {
        if (result.success) this.destroyed.add(cleanupId);
        return result;
      });
    const guarded = operation.finally(() => {
      if (this.destroying.get(cleanupId) === guarded) this.destroying.delete(cleanupId);
    });
    this.destroying.set(cleanupId, guarded);
    return guarded;
  }

  async recreate(
    cleanRoom: CleanRoomWorkspace,
    input: CreateCleanRoomInput
  ): Promise<Result<CleanRoomWorkspace, CleanRoomWorkspaceError>> {
    const destroyed = await this.destroy(cleanRoom, input.project);
    if (!destroyed.success) return destroyed;
    return this.create(input);
  }

  private async persistPendingCleanup(
    record: CleanRoomPendingCleanup,
    expectedRevision: number | null
  ): Promise<Result<void, CleanRoomWorkspaceError>> {
    try {
      const saved = await this.deps.cleanupJournal.save(
        clonePendingCleanup(record),
        expectedRevision
      );
      if (!saved) {
        return err({
          type: 'cleanup-journal-failed',
          message: 'Clean-room cleanup state changed concurrently.',
        });
      }
      return ok();
    } catch {
      return err({
        type: 'cleanup-journal-failed',
        message: 'Clean-room cleanup state could not be persisted.',
      });
    }
  }

  private async persistCreationCheckpoint(
    desired: CleanRoomPendingCleanup,
    expectedRevision: number | null
  ): Promise<Result<CleanRoomPendingCleanup, CleanRoomWorkspaceError>> {
    let candidate = clonePendingCleanup(desired);
    let expected = expectedRevision;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let saved = false;
      let saveThrew = false;
      try {
        saved = await this.deps.cleanupJournal.save(clonePendingCleanup(candidate), expected);
      } catch {
        saveThrew = true;
      }
      if (saved) return ok(candidate);

      let current: CleanRoomPendingCleanup | undefined;
      try {
        current = await this.deps.cleanupJournal.load(candidate.cleanupId);
      } catch {
        return err({
          type: 'cleanup-journal-failed',
          message: 'Clean-room cleanup state could not be loaded for reconciliation.',
        });
      }
      if (expected === null) {
        if (saveThrew && current && samePendingCleanupCheckpoint(current, candidate)) {
          return ok(clonePendingCleanup(current));
        }
        return err(
          saveThrew && !current
            ? {
                type: 'cleanup-journal-failed',
                message: 'Clean-room cleanup state could not be persisted.',
              }
            : journalCheckpointFailure()
        );
      }
      if (!current || !samePendingCleanupAuthority(current, candidate)) {
        return err(
          saveThrew
            ? {
                type: 'cleanup-journal-failed',
                message: 'Clean-room cleanup state could not be reconciled after persistence.',
              }
            : journalCheckpointFailure()
        );
      }
      const reconciled = reconcileCreationCheckpoint(current, candidate);
      if (!reconciled) return err(journalCheckpointFailure());
      if (reconciled.revision === current.revision) return ok(reconciled);
      expected = current.revision;
      candidate = reconciled;
    }
    return err({
      type: 'cleanup-journal-failed',
      message: 'Clean-room cleanup state could not be reconciled after concurrent updates.',
    });
  }

  private async discardCreationIntent(
    record: CleanRoomPendingCleanup
  ): Promise<Result<void, CleanRoomWorkspaceError>> {
    if (
      record.worktreeOwnership !== 'intent' ||
      record.revision !== 0 ||
      record.completed.teardown ||
      record.completed.worktree ||
      record.completed.branch
    ) {
      return err(invalidIdentityError());
    }
    try {
      const removed = await this.deps.cleanupJournal.remove(record.cleanupId, record.revision);
      return removed
        ? ok()
        : err({
            type: 'cleanup-journal-failed',
            message: 'Clean-room creation intent changed concurrently.',
          });
    } catch {
      return err({
        type: 'cleanup-journal-failed',
        message: 'Clean-room creation intent could not be discarded.',
      });
    }
  }

  private async discardCreationIntentIfExact(record: CleanRoomPendingCleanup): Promise<void> {
    try {
      const current = await this.deps.cleanupJournal.load(record.cleanupId);
      if (!current || !samePendingCleanupCheckpoint(current, record)) return;
      await this.deps.cleanupJournal.remove(record.cleanupId, record.revision);
    } catch {
      // The exact durable intent remains recoverable when the journal is temporarily unavailable.
    }
  }

  private async runPendingCleanup(
    cleanupId: string,
    project: CleanRoomProject
  ): Promise<Result<void, CleanRoomWorkspaceError>> {
    let provisional: CleanRoomPendingCleanup | undefined;
    try {
      provisional = await this.deps.cleanupJournal.load(cleanupId);
    } catch {
      return err({
        type: 'cleanup-journal-failed',
        message: 'Clean-room cleanup state could not be loaded.',
      });
    }
    if (!provisional) {
      return err({
        type: 'cleanup-journal-failed',
        message: 'Clean-room cleanup state was not found.',
      });
    }

    const provisionalValidation = await validatePendingCleanup(provisional, project);
    if (!provisionalValidation.success) return provisionalValidation;
    provisional = provisionalValidation.data;

    let teardownQuiesced = false;
    if (!provisional.completed.teardown && provisional.teardownRequired) {
      try {
        await this.deps.workspaceRegistry.teardown(provisional.workspaceId, 'terminate');
        teardownQuiesced = true;
      } catch {
        return cleanupFailureWithRecord('workspace teardown', provisional);
      }
    }

    await this.waitForCleanupPrerequisites(cleanupId, 'resource');
    await this.waitForCleanupPrerequisites(cleanupId, 'authority');

    let record: CleanRoomPendingCleanup | undefined;
    try {
      record = await this.deps.cleanupJournal.load(cleanupId);
    } catch {
      return err({
        type: 'cleanup-journal-failed',
        message: 'Clean-room cleanup state could not be reloaded after quiescence.',
      });
    }
    if (!record) return ok();
    const validated = await validatePendingCleanup(record, project);
    if (!validated.success) return validated;
    record = validated.data;

    const saveProgress = async (): Promise<Result<void, CleanRoomWorkspaceError>> => {
      const expectedRevision = record!.revision;
      record = { ...record!, revision: expectedRevision + 1 };
      const saved = await this.persistPendingCleanup(record, expectedRevision);
      return saved.success ? saved : cleanupFailureWithRecord('cleanup journal update', record);
    };
    const ref = `refs/heads/${record.branchName}`;
    const readBranchHead = async (): Promise<string> => {
      const listed = await project.ctx.exec(
        'git',
        ['for-each-ref', '--format=%(objectname)', ref],
        { timeout: 60_000 }
      );
      return listed.stdout.trim();
    };
    const isAncestor = async (ancestor: string, descendant: string): Promise<boolean> => {
      try {
        await project.ctx.exec('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
          timeout: 60_000,
        });
        return true;
      } catch {
        return false;
      }
    };

    if (!record.completed.teardown) {
      if (record.teardownRequired) {
        if (!teardownQuiesced) {
          try {
            await this.deps.workspaceRegistry.teardown(record.workspaceId, 'terminate');
          } catch {
            return cleanupFailureWithRecord('workspace teardown', record);
          }
        }
      }
      record.completed.teardown = true;
      const saved = await saveProgress();
      if (!saved.success) return saved;
    }

    if (!record.completed.worktree) {
      try {
        await project.worktreeService.waitForGeneratedWorktreeOperations(record.target.path);
        const actualBranchHead = await readBranchHead();
        if (
          actualBranchHead &&
          actualBranchHead.toLowerCase() !== record.branchHead.toLowerCase()
        ) {
          const replayAdvanced =
            record.worktreeOwnership === 'attested' &&
            FULL_COMMIT_PATTERN.test(actualBranchHead) &&
            (await isAncestor(record.baseCommit, actualBranchHead)) &&
            (await isAncestor(actualBranchHead, record.expectedFeatureHead)) &&
            (await isAncestor(record.branchHead, actualBranchHead));
          if (!replayAdvanced) {
            return cleanupFailureWithRecord('temporary branch movement', record);
          }
          record.branchHead = actualBranchHead;
          const saved = await saveProgress();
          if (!saved.success) return saved;
        }
        const requireClean = record.worktreeOwnership === 'intent';
        const removed = await project.worktreeService.removeGeneratedWorktreeIfPresent(
          record.target.path,
          {
            expectedBranchName: record.branchName,
            expectedHead: record.branchHead,
            ...(requireClean ? { requireClean: true } : {}),
          }
        );
        if (!removed.success) return cleanupFailureWithRecord('worktree removal', record);
      } catch {
        return cleanupFailureWithRecord('worktree removal', record);
      }
      record.completed.worktree = true;
      const saved = await saveProgress();
      if (!saved.success) return saved;
    }

    if (!record.completed.branch) {
      try {
        const currentHead = await readBranchHead();
        if (currentHead) {
          if (currentHead.toLowerCase() !== record.branchHead.toLowerCase()) {
            return cleanupFailureWithRecord('temporary branch movement', record);
          }
          try {
            await project.ctx.exec('git', ['update-ref', '-d', ref, record.branchHead], {
              timeout: 60_000,
            });
          } catch {
            const afterFailure = await readBranchHead();
            if (afterFailure) {
              return cleanupFailureWithRecord('temporary branch removal', record);
            }
          }
          const afterRemoval = await readBranchHead();
          if (afterRemoval) {
            return cleanupFailureWithRecord('temporary branch movement', record);
          }
        }
      } catch {
        return cleanupFailureWithRecord('temporary branch removal', record);
      }
      record.completed.branch = true;
      const saved = await saveProgress();
      if (!saved.success) return saved;
    }

    try {
      const removed = await this.deps.cleanupJournal.remove(cleanupId, record.revision);
      if (!removed) {
        const remaining = await this.deps.cleanupJournal.load(cleanupId);
        if (remaining) return cleanupFailureWithRecord('cleanup journal removal', record);
      }
      return ok();
    } catch {
      try {
        const remaining = await this.deps.cleanupJournal.load(cleanupId);
        if (!remaining) return ok();
      } catch {
        // Preserve the durable cleanup record and surface a retryable failure below.
      }
      return cleanupFailureWithRecord('cleanup journal removal', record);
    }
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

class CleanRoomOperationStopped extends Error {
  constructor(readonly failure: CleanRoomStopFailure) {
    super(failure.message);
  }
}

function awaitWithCleanRoomControl<T>(
  operation: Promise<T>,
  control: CleanRoomOperationControl,
  recheckControlOnResolution = true
): Promise<T> {
  const stopped = cleanRoomOperationFailure(control.signal, control.deadlineAt);
  if (stopped) return Promise.reject(new CleanRoomOperationStopped(stopped));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      control.signal?.removeEventListener('abort', onAbort);
      complete();
    };
    const stop = (): void => {
      const failure = cleanRoomOperationFailure(control.signal, control.deadlineAt);
      if (failure) finish(() => reject(new CleanRoomOperationStopped(failure)));
    };
    const scheduleDeadline = (): void => {
      const remaining = control.deadlineAt - Date.now();
      if (remaining <= 0) {
        stop();
        return;
      }
      timer = setTimeout(scheduleDeadline, remaining);
      timer.unref?.();
    };
    const onAbort = (): void => stop();

    scheduleDeadline();
    if (!settled) {
      control.signal?.addEventListener('abort', onAbort, { once: true });
      if (control.signal?.aborted) onAbort();
    }

    operation.then(
      (value) => {
        const failure = recheckControlOnResolution
          ? cleanRoomOperationFailure(control.signal, control.deadlineAt)
          : undefined;
        finish(() => (failure ? reject(new CleanRoomOperationStopped(failure)) : resolve(value)));
      },
      (cause) => finish(() => reject(cause))
    );
  });
}

function awaitWithCleanRoomQuiescentMutationControl<T>(
  operation: Promise<T>,
  control: CleanRoomOperationControl
): Promise<T> {
  return awaitWithCleanRoomControl(operation, control, false);
}

function stoppedCleanRoomFailure(
  cause: unknown,
  control: CleanRoomOperationControl | undefined
): CleanRoomWorkspaceError | undefined {
  if (cause instanceof CleanRoomOperationStopped) return cause.failure;
  return control ? cleanRoomOperationFailure(control.signal, control.deadlineAt) : undefined;
}

function samePendingCleanupAuthority(
  left: CleanRoomPendingCleanup,
  right: CleanRoomPendingCleanup
): boolean {
  return (
    left.version === right.version &&
    left.cleanupId === right.cleanupId &&
    left.verificationRunId === right.verificationRunId &&
    left.attempt === right.attempt &&
    left.projectId === right.projectId &&
    left.workspaceId === right.workspaceId &&
    left.target.path === right.target.path &&
    sameMachine(left.target.machine, right.target.machine) &&
    sameTargetIdentity(left.featureTarget, right.featureTarget) &&
    left.branchName === right.branchName &&
    left.baseCommit === right.baseCommit &&
    left.expectedFeatureHead === right.expectedFeatureHead
  );
}

function samePendingCleanupCheckpoint(
  left: CleanRoomPendingCleanup,
  right: CleanRoomPendingCleanup
): boolean {
  return (
    samePendingCleanupAuthority(left, right) &&
    left.worktreeOwnership === right.worktreeOwnership &&
    left.teardownRequired === right.teardownRequired &&
    left.branchHead.toLowerCase() === right.branchHead.toLowerCase() &&
    left.completed.teardown === right.completed.teardown &&
    left.completed.worktree === right.completed.worktree &&
    left.completed.branch === right.completed.branch &&
    left.revision === right.revision
  );
}

function reconcileCreationCheckpoint(
  current: CleanRoomPendingCleanup,
  desired: CleanRoomPendingCleanup
): CleanRoomPendingCleanup | undefined {
  const currentHead = creationHeadRank(current.branchHead, current);
  const desiredHead = creationHeadRank(desired.branchHead, desired);
  if (
    currentHead === undefined ||
    desiredHead === undefined ||
    current.completed.teardown ||
    current.completed.worktree ||
    current.completed.branch
  ) {
    return undefined;
  }
  const ownershipSatisfied =
    current.worktreeOwnership === 'attested' || desired.worktreeOwnership === 'intent';
  const teardownSatisfied = current.teardownRequired || !desired.teardownRequired;
  const headSatisfied = currentHead >= desiredHead;
  if (ownershipSatisfied && teardownSatisfied && headSatisfied) {
    return clonePendingCleanup(current);
  }
  return {
    ...clonePendingCleanup(current),
    worktreeOwnership:
      current.worktreeOwnership === 'attested' || desired.worktreeOwnership === 'attested'
        ? 'attested'
        : 'intent',
    teardownRequired: current.teardownRequired || desired.teardownRequired,
    branchHead: desiredHead > currentHead ? desired.branchHead : current.branchHead,
    revision: current.revision + 1,
  };
}

function creationHeadRank(
  head: string,
  record: Pick<CleanRoomPendingCleanup, 'baseCommit' | 'expectedFeatureHead'>
): number | undefined {
  if (head.toLowerCase() === record.baseCommit.toLowerCase()) return 0;
  if (head.toLowerCase() === record.expectedFeatureHead.toLowerCase()) return 1;
  return undefined;
}

function cancelledError(): Extract<CleanRoomWorkspaceError, { type: 'cancelled' }> {
  return { type: 'cancelled', message: 'Clean-room creation was cancelled.' };
}

function cleanRoomDeadlineAt(timeoutMs: number | undefined): number {
  const requested = timeoutMs ?? CLEAN_ROOM_TIMEOUT_MS;
  const normalized = Number.isFinite(requested)
    ? Math.min(MAX_CLEAN_ROOM_TIMEOUT_MS, Math.max(1, requested))
    : CLEAN_ROOM_TIMEOUT_MS;
  return Date.now() + normalized;
}

function deadlineExceededError(): Extract<CleanRoomWorkspaceError, { type: 'deadline-exceeded' }> {
  return {
    type: 'deadline-exceeded',
    message: 'Clean-room creation deadline was exceeded.',
  };
}

function cleanRoomOperationFailure(
  signal: AbortSignal | undefined,
  deadlineAt: number
): CleanRoomStopFailure | undefined {
  if (signal?.aborted) return cancelledError();
  if (deadlineAt <= Date.now()) return deadlineExceededError();
  return undefined;
}

function mapFeatureFailure(
  cause: FeatureSnapshotError,
  fallback: 'snapshot-failed' | 'replay-failed'
): CleanRoomWorkspaceError {
  if (cause.type === 'cancelled') return cancelledError();
  if (cause.type === 'deadline-exceeded') return deadlineExceededError();
  return fallback === 'snapshot-failed'
    ? { type: 'snapshot-failed', cause }
    : { type: 'replay-failed', cause };
}

function mapFeatureOperationFailure(
  cause: FeatureSnapshotError
): CleanRoomWorkspaceError | undefined {
  if (cause.type === 'cancelled') return cancelledError();
  if (cause.type === 'deadline-exceeded') return deadlineExceededError();
  return undefined;
}

function mapWorktreeOperationFailure(
  cause: CreateWorktreeAtCommitError
): CleanRoomWorkspaceError | undefined {
  if (cause.type === 'cancelled') return cancelledError();
  if (cause.type === 'deadline-exceeded') return deadlineExceededError();
  return undefined;
}

function mapPreserveOperationFailure(
  cause: CopyPreservedFilesError
): CleanRoomWorkspaceError | undefined {
  if (cause.type === 'cancelled') return cancelledError();
  if (cause.type === 'deadline-exceeded') return deadlineExceededError();
  return undefined;
}

function dependencyFeatureFailure(operation: string): FeatureSnapshotError {
  return {
    type: 'git-failed',
    operation,
    message: 'A required clean-room dependency failed unexpectedly.',
  };
}

function worktreeCreateFailure(): CleanRoomWorkspaceError {
  return {
    type: 'worktree-create-failed',
    message: 'Failed to create clean-room worktree.',
  };
}

function journalCheckpointFailure(): Extract<
  CleanRoomWorkspaceError,
  { type: 'cleanup-journal-failed' }
> {
  return {
    type: 'cleanup-journal-failed',
    message: 'Clean-room cleanup state changed concurrently.',
  };
}

function cloneTarget(target: LoopSessionTarget): LoopSessionTarget {
  return { ...target, machine: { ...target.machine } };
}

function cloneWorkspace(workspace: CleanRoomWorkspace): CleanRoomWorkspace {
  return { ...workspace, target: cloneTarget(workspace.target) };
}

function sameTargetIdentity(left: LoopSessionTarget, right: LoopSessionTarget): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.path === right.path &&
    sameMachine(left.machine, right.machine)
  );
}

function sameWorkspaceIdentity(left: CleanRoomWorkspace, right: CleanRoomWorkspace): boolean {
  return (
    left.projectId === right.projectId &&
    left.cleanupId === right.cleanupId &&
    left.verificationRunId === right.verificationRunId &&
    left.attempt === right.attempt &&
    sameTargetIdentity(left.target, right.target) &&
    left.branchName === right.branchName &&
    left.baseCommit === right.baseCommit &&
    left.expectedFeatureHead === right.expectedFeatureHead &&
    left.replayedThroughCommit === right.replayedThroughCommit
  );
}

async function validatePendingCleanup(
  input: CleanRoomPendingCleanup,
  project: CleanRoomProject,
  control?: CleanRoomOperationControl
): Promise<Result<CleanRoomPendingCleanup, CleanRoomWorkspaceError>> {
  const parsed = parseCleanRoomPendingCleanup(input);
  if (!parsed.success) return err(invalidIdentityError());
  const record = parsed.data;
  if (
    record.projectId !== project.projectId ||
    !sameMachine(record.target.machine, project.defaultWorkspaceMachine) ||
    !sameMachine(record.featureTarget.machine, project.defaultWorkspaceMachine)
  ) {
    return err(invalidIdentityError());
  }
  try {
    const operation = project.worktreeService.resolveGeneratedWorktreePath(record.branchName);
    const resolved = control
      ? await awaitWithCleanRoomControl(operation, control)
      : await operation;
    if (!resolved.success || resolved.data !== record.target.path) {
      return err(invalidIdentityError());
    }
  } catch (cause) {
    const stoppedFailure = stoppedCleanRoomFailure(cause, control);
    if (stoppedFailure) return err(stoppedFailure);
    return err(invalidIdentityError());
  }
  return ok(clonePendingCleanup(record));
}

function invalidIdentityError(): CleanRoomWorkspaceError {
  return {
    type: 'invalid-clean-room-identity',
    message: 'Clean-room workspace identity could not be validated.',
  };
}

function unsupportedCleanRoomError(): Extract<
  CleanRoomWorkspaceError,
  { type: 'unsupported-clean-room' }
> {
  return {
    type: 'unsupported-clean-room',
    message:
      'This workspace provider does not expose the immutable same-machine Git-worktree capability required for clean-room verification.',
  };
}

function cleanupFailureWithRecord(
  stage: string,
  record: CleanRoomPendingCleanup
): Result<never, CleanRoomWorkspaceError> {
  return err({
    type: 'cleanup-failed',
    message: `Clean-room cleanup failed during ${stage}.`,
    pendingCleanup: clonePendingCleanup(record),
  });
}
