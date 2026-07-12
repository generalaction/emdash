import { err, ok, type Result } from '@emdash/shared';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import type { CreateWorktreeAtCommitError } from '@main/core/projects/worktrees/worktree-service';
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

const CLEAN_ROOM_TIMEOUT_MS = 10 * 60_000;
const FULL_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

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
  private readonly issuedWorkspaces = new Map<string, IssuedCleanRoom>();

  constructor(private readonly deps: CleanRoomWorkspaceServiceDependencies) {}

  async preflight(
    input: Pick<CreateCleanRoomInput, 'project' | 'featureTarget'>
  ): Promise<Result<void, CleanRoomWorkspaceError>> {
    const { project, featureTarget } = input;
    let sourceCapability: CleanRoomSourceCapability;
    try {
      sourceCapability = await this.deps.resolveSourceCapability(project, featureTarget);
    } catch {
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
    const supported = await this.preflight(input);
    if (!supported.success) return supported;
    const deadlineAt = Date.now() + Math.max(1, input.timeoutMs ?? CLEAN_ROOM_TIMEOUT_MS);
    const stopped = cleanRoomOperationFailure(input.signal, deadlineAt);
    if (stopped) return err(stopped);

    const snapshotService = this.deps.createFeatureSnapshotService(input.project.ctx);
    let snapshot;
    try {
      snapshot = await snapshotService.capture({
        featurePath: input.featureTarget.path,
        baseCommit: input.baseCommit,
        expectedFeatureHead: input.expectedFeatureHead,
        signal: input.signal,
        deadlineAt,
      });
    } catch {
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
      resolvedTarget = await input.project.worktreeService.resolveGeneratedWorktreePath(branchName);
    } catch {
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
      teardownRequired: false,
      completed: { teardown: false, worktree: false, branch: false },
      revision: 0,
    };
    const journaled = await this.persistPendingCleanup(pendingCleanup, null);
    if (!journaled.success) return journaled;

    const failAfterCleanup = async (
      failure: CleanRoomWorkspaceError
    ): Promise<Result<never, CleanRoomWorkspaceError>> => {
      const cleaned = await this.retryPendingCleanup(cleanupId, input.project);
      return cleaned.success ? err(failure) : cleaned;
    };

    let created;
    try {
      created = await input.project.worktreeService.createWorktreeAtCommit(
        snapshot.data.baseCommit,
        branchName,
        { signal: input.signal, deadlineAt, expectedTargetPath: worktreePath }
      );
    } catch {
      return failAfterCleanup(worktreeCreateFailure());
    }
    if (!created.success) {
      const operationFailure = mapWorktreeOperationFailure(created.error);
      return failAfterCleanup(operationFailure ?? worktreeCreateFailure());
    }
    if (created.data !== worktreePath) return failAfterCleanup(worktreeCreateFailure());

    let expectedJournalRevision = pendingCleanup.revision;
    pendingCleanup = {
      ...pendingCleanup,
      branchHead: snapshot.data.baseCommit,
      revision: expectedJournalRevision + 1,
    };
    const createdJournaled = await this.persistPendingCleanup(
      pendingCleanup,
      expectedJournalRevision
    );
    if (!createdJournaled.success) return failAfterCleanup(createdJournaled.error);

    const stoppedBeforeReplay = cleanRoomOperationFailure(input.signal, deadlineAt);
    if (stoppedBeforeReplay) return failAfterCleanup(stoppedBeforeReplay);
    let replayed;
    try {
      replayed = await snapshotService.replay({
        verificationPath: worktreePath,
        snapshot: snapshot.data,
        signal: input.signal,
        deadlineAt,
      });
    } catch {
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
    const replayJournaled = await this.persistPendingCleanup(
      pendingCleanup,
      expectedJournalRevision
    );
    if (!replayJournaled.success) return failAfterCleanup(replayJournaled.error);

    const stoppedBeforePreserve = cleanRoomOperationFailure(input.signal, deadlineAt);
    if (stoppedBeforePreserve) return failAfterCleanup(stoppedBeforePreserve);
    let preserved;
    try {
      preserved = await input.project.worktreeService.copyPreservedFilesToWorktree(worktreePath, {
        strict: true,
        generatedBranchName: branchName,
      });
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

    expectedJournalRevision = pendingCleanup.revision;
    pendingCleanup = {
      ...pendingCleanup,
      teardownRequired: true,
      revision: expectedJournalRevision + 1,
    };
    const acquisitionJournaled = await this.persistPendingCleanup(
      pendingCleanup,
      expectedJournalRevision
    );
    if (!acquisitionJournaled.success) return failAfterCleanup(acquisitionJournaled.error);

    let acquired;
    try {
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
    const identity = await this.validateIssuedWorkspace(
      input.cleanRoom,
      input.featureTarget,
      input.project,
      true
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
    const deadlineAt = Date.now() + Math.max(1, input.timeoutMs ?? CLEAN_ROOM_TIMEOUT_MS);
    const stopped = cleanRoomOperationFailure(input.signal, deadlineAt);
    if (stopped) return err(stopped);
    const snapshotService = this.deps.createFeatureSnapshotService(input.project.ctx);
    let fixAttestation;
    try {
      fixAttestation = await snapshotService.capture({
        featurePath: identity.data.workspace.target.path,
        baseCommit: input.expectedFeatureHead,
        expectedFeatureHead: input.fixCommit,
        signal: input.signal,
        deadlineAt,
      });
    } catch {
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
      input.project
    );
    if (!fixCheckpointed.success) return fixCheckpointed;
    let result;
    try {
      result = await snapshotService.integrateFix({
        featurePath: identity.data.featureTarget.path,
        expectedFeatureHead: input.expectedFeatureHead,
        fixCommit: input.fixCommit,
        signal: input.signal,
        deadlineAt,
      });
    } catch {
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
    requireWorktreeAttestation: boolean
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
      pending = await this.deps.cleanupJournal.load(cleanRoom.cleanupId);
    } catch {
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
      const canonical = await project.worktreeService.resolveGeneratedWorktreePath(
        cleanRoom.branchName
      );
      if (!canonical.success || canonical.data !== cleanRoom.target.path) {
        return err(invalidIdentityError());
      }
      if (requireWorktreeAttestation) {
        const attested = await project.worktreeService.attestGeneratedWorktree(
          cleanRoom.target.path,
          cleanRoom.branchName
        );
        if (!attested.success) return err(invalidIdentityError());
      }
    } catch {
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
    project: CleanRoomProject
  ): Promise<Result<void, CleanRoomWorkspaceError>> {
    let record: CleanRoomPendingCleanup | undefined;
    try {
      record = await this.deps.cleanupJournal.load(cleanupId);
    } catch {
      return err({
        type: 'cleanup-journal-failed',
        message: 'Clean-room cleanup state could not be loaded.',
      });
    }
    if (!record) return err(invalidIdentityError());
    const validated = await validatePendingCleanup(record, project);
    if (!validated.success) return validated;
    record = validated.data;
    if (record.branchHead === branchHead) return ok();
    if (record.branchHead !== record.expectedFeatureHead) return err(invalidIdentityError());
    const expectedRevision = record.revision;
    record = { ...record, branchHead, revision: expectedRevision + 1 };
    return this.persistPendingCleanup(record, expectedRevision);
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

  private async runPendingCleanup(
    cleanupId: string,
    project: CleanRoomProject
  ): Promise<Result<void, CleanRoomWorkspaceError>> {
    let record: CleanRoomPendingCleanup | undefined;
    try {
      record = await this.deps.cleanupJournal.load(cleanupId);
    } catch {
      return err({
        type: 'cleanup-journal-failed',
        message: 'Clean-room cleanup state could not be loaded.',
      });
    }
    if (!record) {
      return err({
        type: 'cleanup-journal-failed',
        message: 'Clean-room cleanup state was not found.',
      });
    }

    const validated = await validatePendingCleanup(record, project);
    if (!validated.success) return validated;
    record = validated.data;

    const saveProgress = async (): Promise<Result<void, CleanRoomWorkspaceError>> => {
      const expectedRevision = record!.revision;
      record = { ...record!, revision: expectedRevision + 1 };
      const saved = await this.persistPendingCleanup(record, expectedRevision);
      return saved.success ? saved : cleanupFailureWithRecord('cleanup journal update', record);
    };

    if (!record.completed.teardown) {
      if (record.teardownRequired) {
        try {
          await this.deps.workspaceRegistry.teardown(record.workspaceId, 'terminate');
        } catch {
          return cleanupFailureWithRecord('workspace teardown', record);
        }
      }
      record.completed.teardown = true;
      const saved = await saveProgress();
      if (!saved.success) return saved;
    }

    if (record.branchHead === undefined) {
      try {
        const ref = `refs/heads/${record.branchName}`;
        const listed = await project.ctx.exec(
          'git',
          ['for-each-ref', '--format=%(objectname)', ref],
          { timeout: 60_000 }
        );
        const branchHead = listed.stdout.trim();
        if (branchHead && !FULL_COMMIT.test(branchHead)) {
          return cleanupFailureWithRecord('temporary branch attestation', record);
        }
        if (branchHead) {
          return cleanupFailureWithRecord('generated worktree ownership checkpoint', record);
        }
        const absent = await project.worktreeService.removeGeneratedWorktreeIfPresent(
          record.target.path,
          { expectedBranchName: record.branchName, expectedHead: null }
        );
        if (!absent.success || absent.data.removed) {
          return cleanupFailureWithRecord('generated worktree absence attestation', record);
        }
        record.branchHead = null;
      } catch {
        return cleanupFailureWithRecord('temporary branch attestation', record);
      }
      const saved = await saveProgress();
      if (!saved.success) return saved;
    }

    if (!record.completed.worktree) {
      try {
        const removed = await project.worktreeService.removeGeneratedWorktreeIfPresent(
          record.target.path,
          {
            expectedBranchName: record.branchName,
            expectedHead: record.branchHead,
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
      const ref = `refs/heads/${record.branchName}`;
      try {
        const readBranchHead = async (): Promise<string> => {
          const listed = await project.ctx.exec(
            'git',
            ['for-each-ref', '--format=%(objectname)', ref],
            { timeout: 60_000 }
          );
          return listed.stdout.trim();
        };
        const currentHead = await readBranchHead();
        if (currentHead) {
          if (!record.branchHead || currentHead.toLowerCase() !== record.branchHead.toLowerCase()) {
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

function cancelledError(): CleanRoomWorkspaceError {
  return { type: 'cancelled', message: 'Clean-room creation was cancelled.' };
}

function deadlineExceededError(): CleanRoomWorkspaceError {
  return {
    type: 'deadline-exceeded',
    message: 'Clean-room creation deadline was exceeded.',
  };
}

function cleanRoomOperationFailure(
  signal: AbortSignal | undefined,
  deadlineAt: number
): CleanRoomWorkspaceError | undefined {
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
  project: CleanRoomProject
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
    const resolved = await project.worktreeService.resolveGeneratedWorktreePath(record.branchName);
    if (!resolved.success || resolved.data !== record.target.path) {
      return err(invalidIdentityError());
    }
  } catch {
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
