import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { KeyedMutex } from '@emdash/shared/concurrency';
import { noopLogger, type Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { type LeasedLiveModelProvider } from '@emdash/wire/rpc';
import { cell, expose, type Cell } from '@emdash/wire/state';
import type { StoreHandle } from '#primitives/sqlite-store/api';
import { workspaceRegistryContract } from '../api/contract';
import type {
  ActivateWorkspaceError,
  CreateWorkspaceError,
  CreateWorktreeError,
  DeleteWorkspaceError,
  DeleteWorktreeError,
  WorkspaceNotFoundError,
} from '../api/errors';
import type {
  ActivateWorkspaceInput,
  CreateWorkspaceInput,
  CreateWorktreeInput,
  DeactivateWorkspaceInput,
  DeleteWorkspaceInput,
  DeleteWorktreeInput,
  RefreshWorkspacesInput,
  RetryPushBranchInput,
  WorkspaceBackgroundStep,
  WorkspaceRecord,
  WorkspaceRecords,
  WorkspaceRemovalAttempt,
  WorkspaceRuntimeOverlay,
} from '../api/schemas';
import { WorkspaceActivationManager, type WorkspaceDeactivationResult } from './activation';
import { executeFetchRefs, executePushBranch } from './background-steps';
import { executeCloneArtifacts } from './clone-artifacts';
import { executeCreateWorktree } from './create-worktree';
import { executeDeleteWorktree } from './delete-worktree';
import {
  canonicalizeWorkspacePath,
  inspectWorkspacePath,
  type PathInspector,
} from './inspect-path';
import { WorkspaceRecordStore, type DurableWorkspaceRecord } from './persistence/record-store';
import type { WorkspaceRegistryDb } from './persistence/store';
import {
  createUntrackedLinesCache,
  listRepositoryWorktrees,
  observeWorkspaceGit,
  observeWorkspaceGitRefs,
  type UntrackedLinesCache,
  type WorktreeListing,
} from './scan/observe-git';
import type { ScanRequest, ScanTarget } from './scan/scheduler';
import type { WorkspaceScriptRunner } from './script-runner';
import type { SessionKiller } from './session-cleanup';

export type WorkspaceRegistryRuntimeOptions = {
  handle: StoreHandle<WorkspaceRegistryDb>;
  clock?: Clock;
  logger?: Logger;
  /** Test seam for hosts without git; production always inspects the real filesystem. */
  inspector?: PathInspector;
  /** Invoked after every records change; the component points the scheduler at it. */
  onRecordsChanged?: () => void;
  /** deactivateWorkspace's session-plane step; the component builds it from the session runtimes. */
  killSessions?: SessionKiller;
  activation?: {
    runner?: WorkspaceScriptRunner;
    teardownTimeoutMs?: number;
  };
};

/**
 * The sole writer of the host workspace registry (ADR 0005): clients mutate only through
 * the wire verbs; the scan is the second feeder — it reconciles the registry with the
 * disk (adopt/un-adopt worktrees, flip missing, relink moves) but never converges the
 * disk toward a record. `records` merges durable rows with the in-memory runtime
 * overlay — the overlay dies with the daemon, by design.
 */
export class WorkspaceRegistryRuntime {
  private readonly store: WorkspaceRecordStore;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly inspector: PathInspector;
  private onRecordsChanged: (() => void) | undefined;
  private readonly overlays = new Map<string, WorkspaceRuntimeOverlay>();
  private readonly recordsCell: Cell<WorkspaceRecords>;
  private mutationQueue: Promise<unknown> = Promise.resolve();
  /** Exclusive per-repository claim: concurrent same-repo creations wait, never error. */
  private readonly repositoryClaims = new KeyedMutex();
  /** Exclusive per-workspace claim: activate/deactivate/delete on one record serialize. */
  private readonly workspaceClaims = new KeyedMutex();
  /** Per-record untracked line-count caches; evicted when the record vanishes. */
  private readonly untrackedCaches = new Map<string, UntrackedLinesCache>();
  /** In-flight background-step runs, coalesced per workspace id. */
  private readonly backgroundRuns = new Map<string, Promise<void>>();
  /** In-flight artifact clones — the promise the activation artifact gate awaits. */
  private readonly cloneRuns = new Map<string, Promise<void>>();
  /** Debounce stamps for the advisory fetch-refs step, keyed by repository path. */
  private readonly lastFetchAt = new Map<string, number>();
  private readonly killSessions: SessionKiller;
  private readonly activationManager: WorkspaceActivationManager;
  readonly recordsHost: LeasedLiveModelProvider<typeof workspaceRegistryContract.records>;

  constructor(options: WorkspaceRegistryRuntimeOptions) {
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? noopLogger;
    this.inspector = options.inspector ?? inspectWorkspacePath;
    this.onRecordsChanged = options.onRecordsChanged;
    this.store = new WorkspaceRecordStore(options.handle);
    this.killSessions = options.killSessions ?? (async () => undefined);
    this.activationManager = new WorkspaceActivationManager({
      publishActivation: (id, activation) =>
        this.updateOverlay(id, (overlay) => ({ ...overlay, activation })),
      setNotice: (id, script, message) =>
        this.updateOverlay(id, (overlay) => ({
          ...overlay,
          notices: [
            ...overlay.notices.filter((notice) => notice.id !== `script-failed:${script}`),
            {
              id: `script-failed:${script}`,
              kind: 'script-failed',
              script,
              message,
              at: this.clock.now(),
            },
          ],
        })),
      clearNotice: (id, script) =>
        this.updateOverlay(id, (overlay) => ({
          ...overlay,
          notices: overlay.notices.filter((notice) => notice.id !== `script-failed:${script}`),
        })),
      recordScriptOutcome: (id, script, report) =>
        void this.enqueue(async () => {
          const record = this.store.get(id);
          if (!record) return;
          const now = this.clock.now();
          const outcomes = record.scriptOutcomes ?? { prepare: null, setup: null, run: null };
          const updated: DurableWorkspaceRecord = {
            ...record,
            // Overwrite-in-place: one durable last outcome per script, no event list.
            scriptOutcomes: { ...outcomes, [script]: { ...report, at: now } },
            updatedAt: now,
          };
          this.store.update(updated);
          this.publish(updated);
        }).catch((error) => {
          this.logger.warn?.(`recording ${script} outcome for '${id}' failed`, { error });
        }),
      recordActivated: (id, at) =>
        this.enqueue(async () => {
          const record = this.store.get(id);
          if (!record) return;
          const updated: DurableWorkspaceRecord = { ...record, lastActivatedAt: at, updatedAt: at };
          this.store.update(updated);
          this.publish(updated);
        }),
      runner: options.activation?.runner,
      teardownTimeoutMs: options.activation?.teardownTimeoutMs,
      // The artifact gate (dependency gating): prepare/setup wait for the background
      // clone to settle; a terminal clone failure opens the gates anyway.
      awaitArtifacts: (id) => this.awaitCloneArtifacts(id),
      clock: this.clock,
      logger: this.logger,
    });

    const initial: WorkspaceRecords = {};
    for (const record of this.store.list()) {
      initial[record.id] = this.toWire(record);
    }
    this.recordsCell = cell<WorkspaceRecords>(initial, { name: 'workspace-records' });
    this.recordsHost = expose(workspaceRegistryContract.records, {
      list: () => this.recordsCell,
    });

    // Restart replay: background steps left pending/running (a daemon killed mid-step)
    // re-run exactly once; terminal statuses (failed/succeeded/skipped) are respected.
    queueMicrotask(() => {
      for (const record of this.store.list()) {
        if (hasIncompleteBackgroundSteps(record)) void this.runBackgroundSteps(record.id);
      }
    });
  }

  dispose(): void {
    this.activationManager.dispose();
    this.recordsHost.dispose();
  }

  createWorkspace(
    input: CreateWorkspaceInput
  ): Promise<Result<WorkspaceRecord, CreateWorkspaceError>> {
    return this.enqueue(() => this.createWorkspaceLocked(input));
  }

  /**
   * Deactivate-if-active + unregister. Never touches disk; idempotent on absent ids.
   * A failing teardown is a removal-stage failure: recorded durably on the record
   * before the error returns, so the delete stays visible and retryable (ADR 0006).
   */
  deleteWorkspace(input: DeleteWorkspaceInput): Promise<Result<void, DeleteWorkspaceError>> {
    return this.workspaceClaims.runExclusive(input.id, async () => {
      const record = this.store.get(input.id);
      if (record) {
        const teardownFailure = await this.deactivateForRemoval(record);
        if (teardownFailure) return err(teardownFailure);
      }
      return await this.enqueue(() => Promise.resolve(this.deleteWorkspaceLocked(input)));
    });
  }

  /**
   * Deactivate + force-remove the worktree artifact (+ branch when asked) + unregister,
   * as one call. Held under the per-workspace claim (serializing against activate/
   * deactivate/delete on this record) and the per-repository claim (serializing against
   * createWorktree on the same repository). A removal failure leaves the record
   * registered so the delete stays retryable.
   */
  async deleteWorktree(input: DeleteWorktreeInput): Promise<Result<void, DeleteWorktreeError>> {
    // The repository key is resolved before claiming so acquisition keeps the fixed
    // repo-before-workspace order (spec locking rule) shared with createWorktree.
    const record = this.store.get(input.id);
    if (!record) return ok(undefined);
    if (record.kind !== 'worktree') {
      return err({ type: 'not-a-worktree', workspaceId: input.id });
    }
    const parent = record.parentId === null ? null : this.store.get(record.parentId);
    const repositoryPath = await this.resolveRepositoryPath(record, parent);

    if (repositoryPath === null) {
      return this.workspaceClaims.runExclusive(input.id, async () => {
        const current = this.store.get(input.id);
        if (!current) return ok(undefined);
        const teardownFailure = await this.deactivateForRemoval(current);
        if (teardownFailure) return err(teardownFailure);
        if (await isDirectory(current.path)) {
          // Structural: the artifact remains but no repository can prune it — an
          // identical retry cannot converge without user intervention.
          return err(
            await this.recordRemovalFailure(input.id, {
              stage: 'remove',
              class: 'terminal',
              message: `Cannot resolve the owning repository of '${current.path}'`,
            })
          );
        }
        // Artifact already gone and no repository left to prune: just unregister.
        return await this.enqueue(() =>
          Promise.resolve(this.deleteWorkspaceLocked({ id: input.id }))
        );
      });
    }

    return this.repositoryClaims.runExclusive(parent?.id ?? repositoryPath, () =>
      this.workspaceClaims.runExclusive(input.id, async () => {
        const current = this.store.get(input.id);
        if (!current) return ok(undefined);
        const teardownFailure = await this.deactivateForRemoval(current);
        if (teardownFailure) return err(teardownFailure);
        const result = await executeDeleteWorktree({
          repositoryPath,
          worktreePath: current.path,
          deleteBranch: input.deleteBranch,
          branchHint: current.git?.branch ?? current.creation?.branch ?? null,
        });
        if (result.status === 'failed') {
          return err(
            await this.recordRemovalFailure(input.id, {
              stage: 'remove',
              class: result.class,
              message: result.message,
            })
          );
        }
        return await this.enqueue(() =>
          Promise.resolve(this.deleteWorkspaceLocked({ id: input.id }))
        );
      })
    );
  }

  /**
   * One plain RPC end-to-end: durable registration (outcome 'started') happens under
   * the writer queue; the long-running stage pipeline runs under the per-repository
   * claim so unrelated registry work is never blocked; the durable outcome lands under
   * the writer queue again. Progress is only visible through the records overlay.
   */
  async createWorktree(
    input: CreateWorktreeInput
  ): Promise<Result<WorkspaceRecord, CreateWorktreeError>> {
    const registration = await this.enqueue(() =>
      Promise.resolve(this.registerWorktreeCreation(input))
    );
    if (!registration.success) return registration;
    if (registration.data.execute === false) {
      return ok(this.toWire(registration.data.record));
    }
    const repository = registration.data.repository;

    const created = await this.repositoryClaims.runExclusive(repository.id, async () => {
      const startedAt = this.clock.now();
      const stageStarts: Array<{ stage: string; at: number }> = [];
      this.updateOverlay(input.id, (overlay) => ({
        ...overlay,
        creation: { stage: 'inspect', startedAt },
      }));
      stageStarts.push({ stage: 'inspect', at: Date.now() });

      const result = await executeCreateWorktree({
        repositoryPath: repository.path,
        worktreePath: path.resolve(input.path),
        branch: input.branch,
        baseRef: input.baseRef,
        onStage: (stage) => {
          stageStarts.push({ stage, at: Date.now() });
          this.updateOverlay(input.id, (overlay) => ({
            ...overlay,
            creation: { stage, startedAt },
          }));
        },
      });
      this.logStageTimings(input.id, stageStarts, result.status);

      return await this.enqueue(() =>
        Promise.resolve(this.finalizeWorktreeCreation(input, result))
      );
    });

    // The verb returns at agent-spawnable; artifact cloning, branch pushing, and ref
    // freshening continue as durable background steps outside the repository claim.
    if (created.success) void this.runBackgroundSteps(input.id);
    return created;
  }

  refresh(input: RefreshWorkspacesInput): Promise<Result<void, WorkspaceNotFoundError>> {
    return this.enqueue(() => this.refreshLocked(input));
  }

  /**
   * Returns when prepare completes; setup/run continue in the background through the
   * activation manager. Held under the per-workspace claim so a concurrent deactivate
   * waits for the session-gating point instead of interleaving.
   */
  activateWorkspace(
    input: ActivateWorkspaceInput
  ): Promise<Result<WorkspaceRecord, ActivateWorkspaceError>> {
    return this.workspaceClaims.runExclusive(input.id, async () => {
      const record = this.store.get(input.id);
      if (!record) {
        return err({ type: 'workspace-not-found', workspaceId: input.id });
      }
      if (record.observedStatus === 'missing') {
        return err({ type: 'workspace-missing', workspaceId: input.id });
      }
      // Activation replays incomplete background steps (ticket semantics); the
      // activation manager's artifact gate awaits the clone only where scripts need it.
      if (hasIncompleteBackgroundSteps(record)) void this.runBackgroundSteps(input.id);
      await this.activationManager.activate(input.id, record.path);
      const current = this.store.get(input.id) ?? record;
      return ok(this.toWire(current));
    });
  }

  /**
   * Sole owner of session-plane shutdown: kills every session under the workspace path
   * (even for never-activated workspaces — the delete verbs compose this), then runs
   * teardown time-boxed and non-fatal when an activation exists. Idempotent: a second
   * call finds nothing active and no sessions, so teardown runs at most once.
   */
  deactivateWorkspace(
    input: DeactivateWorkspaceInput
  ): Promise<Result<void, WorkspaceNotFoundError>> {
    return this.workspaceClaims.runExclusive(input.id, async () => {
      const record = this.store.get(input.id);
      if (!record) {
        return err({ type: 'workspace-not-found', workspaceId: input.id });
      }
      await this.deactivateLocked(record);
      return ok(undefined);
    });
  }

  /** The shared deactivation step; callers must hold the per-workspace claim. */
  private async deactivateLocked(
    record: DurableWorkspaceRecord
  ): Promise<WorkspaceDeactivationResult> {
    try {
      await this.killSessions(record.path);
    } catch (error) {
      // Best-effort by contract: teardown must still run.
      this.logger.warn?.(`session cleanup for '${record.path}' failed`, { error });
    }
    return await this.activationManager.deactivate(record.id);
  }

  /**
   * The delete verbs' deactivation step: a failed teardown counts as a removal stage
   * (ADR 0006) — recorded durably before the verb returns. Transient by design:
   * teardown runs at most once per activation, so the next attempt proceeds past it.
   */
  private async deactivateForRemoval(
    record: DurableWorkspaceRecord
  ): Promise<DeleteWorkspaceError | null> {
    const { teardownFailure } = await this.deactivateLocked(record);
    if (!teardownFailure) return null;
    return await this.recordRemovalFailure(record.id, {
      stage: 'teardown',
      class: 'transient',
      message: teardownFailure.message,
    });
  }

  /**
   * Durable half of a failed removal: the annotation lands on the record (and the
   * records live model) before the verb returns; the returned error is loop control
   * carrying the same host-decided stage/class facts as the record — nothing the
   * record does not (ADR 0006).
   */
  private async recordRemovalFailure(
    id: string,
    failure: Omit<WorkspaceRemovalAttempt, 'at'>
  ): Promise<DeleteWorkspaceError> {
    await this.enqueue(async () => {
      const record = this.store.get(id);
      if (!record) return;
      const now = this.clock.now();
      const updated: DurableWorkspaceRecord = {
        ...record,
        lastRemovalAttempt: { ...failure, at: now },
        updatedAt: now,
      };
      this.store.update(updated);
      this.publish(updated);
    });
    return {
      type: 'remove-failed',
      stage: failure.stage,
      class: failure.class,
      message: failure.message,
    };
  }

  /** The parent record's path when it is usable, else what the disk says. */
  private async resolveRepositoryPath(
    record: DurableWorkspaceRecord,
    parent: DurableWorkspaceRecord | null
  ): Promise<string | null> {
    if (parent && (await isDirectory(parent.path))) return parent.path;
    const inspection = await this.inspector(record.path);
    return inspection.kind === 'worktree' ? inspection.repositoryPath : null;
  }

  /** Scheduler entry point: executes one coalesced scan request under the writer lock. */
  executeScanRequest(request: ScanRequest): Promise<void> {
    return this.enqueue(async () => {
      const record = this.store.get(request.id);
      if (!record) return;
      if (request.kind === 'repository') {
        await this.scanRepository(record, this.store.list());
        return;
      }
      if (request.mode === 'refs') {
        await this.scanRefsOnly(record);
        return;
      }
      await this.scanRecord(record);
    });
  }

  /** The scheduler's view of the registry: present paths to watch, staleness to bound. */
  scanTargets(): ScanTarget[] {
    return this.store.list().map((record) => ({
      id: record.id,
      kind: record.kind,
      path: record.path,
      parentId: record.parentId,
      observedStatus: record.observedStatus,
      lastObservedAt: record.lastObservedAt,
    }));
  }

  /** Activity escalation gate: activated workspaces (or fresh activations) scan eagerly. */
  isWorkspaceActive(id: string): boolean {
    const overlay = this.overlays.get(id);
    if (overlay?.activation) return true;
    const record = this.store.get(id);
    if (!record || record.lastActivatedAt === null) return false;
    return this.clock.now() - record.lastActivatedAt < 60 * 60_000;
  }

  private async createWorkspaceLocked(
    input: CreateWorkspaceInput
  ): Promise<Result<WorkspaceRecord, CreateWorkspaceError>> {
    const canonical = await canonicalizeWorkspacePath(input.path);
    if (canonical === null) {
      return err({ type: 'path-not-found', path: input.path });
    }

    const existing = this.store.get(input.id);
    if (existing) {
      if (existing.path === canonical) {
        // Idempotent replay: same id, same path — no-op success.
        return ok(this.toWire(existing));
      }
      return err({
        type: 'immutable-field-mismatch',
        workspaceId: input.id,
        message: `Workspace '${input.id}' is registered at '${existing.path}', not '${canonical}'`,
      });
    }

    const byPath = this.store.getByPath(canonical);
    if (byPath) {
      // A second desktop adopts the existing record instead of fighting over the path.
      return err({ type: 'already-registered', record: this.toWire(byPath) });
    }

    const inspection = await this.inspector(canonical);
    if (inspection.kind === 'inspect-failed') {
      return err({ type: 'inspect-failed', path: canonical, message: inspection.message });
    }

    const now = this.clock.now();
    let parentId: string | null = null;
    let gitAdminName: string | null = null;
    if (inspection.kind === 'worktree') {
      parentId = this.ensureRepositoryRegistered(inspection.repositoryPath, now);
      gitAdminName = inspection.gitAdminName;
    }

    const record: DurableWorkspaceRecord = {
      id: input.id,
      kind: inspection.kind,
      path: canonical,
      parentId,
      origin: 'registered',
      gitAdminName,
      observedStatus: 'present',
      creation: null,
      lastCreateOutcome: null,
      background: null,
      lastRemovalAttempt: null,
      scriptOutcomes: null,
      git: null,
      lastActivatedAt: null,
      createdAt: now,
      updatedAt: now,
      lastObservedAt: now,
    };
    this.store.insert(record);
    this.publish(record);
    return ok(this.toWire(record));
  }

  /** Late-bound because the scheduler needs the runtime before it can be pointed at. */
  setOnRecordsChanged(callback: () => void): void {
    this.onRecordsChanged = callback;
  }

  /**
   * The fast durable half of createWorktree: the record exists with outcome 'started'
   * before any git work begins, so a crash mid-flight leaves a visible, retryable fact.
   */
  private registerWorktreeCreation(
    input: CreateWorktreeInput
  ): Result<
    { execute: boolean; record: DurableWorkspaceRecord; repository: DurableWorkspaceRecord },
    CreateWorktreeError
  > {
    const repository = this.store.get(input.repositoryId);
    if (!repository || repository.kind !== 'repository') {
      return err({ type: 'repository-not-found', repositoryId: input.repositoryId });
    }

    const now = this.clock.now();
    const existing = this.store.get(input.id);
    if (existing) {
      const spec = existing.creation;
      const matches =
        spec !== null &&
        spec.branch === input.branch &&
        spec.baseRef === input.baseRef &&
        spec.requestedPath === input.path &&
        existing.parentId === input.repositoryId;
      if (!matches) {
        return err({
          type: 'immutable-field-mismatch',
          workspaceId: input.id,
          message: `Workspace '${input.id}' exists with a different creation spec`,
        });
      }
      if (existing.lastCreateOutcome?.status === 'succeeded') {
        // Replay of a completed creation: no-op foreground success; incomplete
        // background steps re-run through the caller's post-verb kickoff.
        return ok({ execute: false, record: existing, repository });
      }
      // Failed or interrupted: re-execute under a fresh 'started' outcome. The
      // background section is (re)initialized when the fresh artifact finalizes.
      const restarted: DurableWorkspaceRecord = {
        ...existing,
        lastCreateOutcome: { status: 'started', at: now },
        updatedAt: now,
      };
      this.store.update(restarted);
      this.publish(restarted);
      return ok({ execute: true, record: restarted, repository });
    }

    const resolvedPath = path.resolve(input.path);
    const byPath = this.store.getByPath(resolvedPath);
    if (byPath) {
      return err({ type: 'path-conflict', path: resolvedPath });
    }

    const record: DurableWorkspaceRecord = {
      id: input.id,
      kind: 'worktree',
      path: resolvedPath,
      parentId: repository.id,
      origin: 'registered',
      gitAdminName: null,
      // Not on disk yet: 'missing' + outcome 'started' + no overlay reads as
      // "interrupted" after a daemon crash — exactly the diagnostic the spec wants.
      observedStatus: 'missing',
      creation: { branch: input.branch, baseRef: input.baseRef, requestedPath: input.path },
      lastCreateOutcome: { status: 'started', at: now },
      background: null,
      lastRemovalAttempt: null,
      scriptOutcomes: null,
      git: null,
      lastActivatedAt: null,
      createdAt: now,
      updatedAt: now,
      lastObservedAt: now,
    };
    this.store.insert(record);
    this.publish(record);
    return ok({ execute: true, record, repository });
  }

  /** The durable tail of createWorktree: outcome lands, overlay clears, record settles. */
  private async finalizeWorktreeCreation(
    input: CreateWorktreeInput,
    result: Awaited<ReturnType<typeof executeCreateWorktree>>
  ): Promise<Result<WorkspaceRecord, CreateWorktreeError>> {
    const id = input.id;
    this.updateOverlay(id, (overlay) => ({ ...overlay, creation: null }));
    const record = this.store.get(id);
    const now = this.clock.now();
    if (!record) {
      // Deleted while the pipeline ran; report the execution result without a record.
      return err({
        type: 'stage-failed',
        stage: 'finalize',
        message: 'Workspace record was deleted during creation',
      });
    }

    if (result.status === 'failed') {
      const failed: DurableWorkspaceRecord = {
        ...record,
        lastCreateOutcome: {
          status: 'failed',
          at: now,
          stage: result.stage,
          message: result.message,
        },
        updatedAt: now,
      };
      this.store.update(failed);
      this.publish(failed);
      return err({ type: 'stage-failed', stage: result.stage, message: result.message });
    }

    const parent = record.parentId === null ? null : this.store.get(record.parentId);
    let gitAdminName = record.gitAdminName;
    if (parent) {
      try {
        const listing = (await listRepositoryWorktrees(parent.path)).find(
          (entry) => entry.path === result.finalPath
        );
        gitAdminName = listing?.adminName ?? gitAdminName;
      } catch {
        // The scan will fill the admin name on its next pass.
      }
    }
    // Fresh background section for the fresh artifact. Adopting an already-checked-out
    // worktree skips the clone — its artifacts must not be overwritten.
    const background: DurableWorkspaceRecord['background'] = {
      steps: {
        cloneArtifacts: result.createdWorktree
          ? { status: 'pending', at: now }
          : { status: 'skipped', at: now },
        pushBranch: input.pushBranch ? { status: 'pending', at: now } : null,
        fetchRefs: { status: 'pending', at: now },
      },
      preservePatterns: input.preservePatterns,
    };
    const succeeded: DurableWorkspaceRecord = {
      ...record,
      path: result.finalPath,
      gitAdminName,
      observedStatus: 'present',
      background,
      lastCreateOutcome: { status: 'succeeded', at: now },
      git: await observeWorkspaceGit(result.finalPath, undefined, {
        untrackedCache: this.untrackedCacheFor(record.id),
      }),
      updatedAt: now,
      lastObservedAt: now,
    };
    this.store.update(succeeded);
    this.publish(succeeded);
    return ok(this.toWire(succeeded));
  }

  // -------------------------------------------------------------------------
  // Background creation steps (spec: workspace-activation-speed). Durable per-step
  // statuses on the record; runs outside the per-repository claim; replayed
  // idempotently on restart and on activation; never a gate on agent spawn.
  // -------------------------------------------------------------------------

  /** Runs every incomplete background step for one record, coalesced per workspace. */
  private runBackgroundSteps(id: string): Promise<void> {
    const existing = this.backgroundRuns.get(id);
    if (existing) return existing;
    const run = this.executeBackgroundSteps(id)
      .catch((error) => {
        this.logger.warn?.(`background creation steps for '${id}' failed unexpectedly`, { error });
      })
      .finally(() => {
        this.backgroundRuns.delete(id);
      });
    this.backgroundRuns.set(id, run);
    return run;
  }

  private async executeBackgroundSteps(id: string): Promise<void> {
    const record = this.store.get(id);
    if (!record?.background || record.lastCreateOutcome?.status !== 'succeeded') return;
    const parent = record.parentId === null ? null : this.store.get(record.parentId);
    if (!parent) return;
    const repositoryPath = parent.path;
    const branch = record.creation?.branch ?? null;
    const baseRef = record.creation?.baseRef ?? null;
    const steps = record.background.steps;

    const work: Array<Promise<void>> = [];
    if (isIncomplete(steps.cloneArtifacts)) {
      const clone = this.executeCloneStep(id, repositoryPath, record.path).finally(() => {
        this.cloneRuns.delete(id);
      });
      this.cloneRuns.set(id, clone);
      work.push(clone);
    }
    if (branch !== null && isIncomplete(steps.pushBranch)) {
      work.push(this.executePushStep(id, repositoryPath, branch));
    }
    if (baseRef !== null && isIncomplete(steps.fetchRefs)) {
      work.push(this.executeFetchStep(id, repositoryPath, baseRef));
    }
    await Promise.all(work);
  }

  private async executeCloneStep(
    id: string,
    repositoryPath: string,
    worktreePath: string
  ): Promise<void> {
    const preservePatterns = this.store.get(id)?.background?.preservePatterns ?? [];
    await this.updateBackgroundStep(id, 'cloneArtifacts', { status: 'running' });
    const startedAt = Date.now();
    const outcome = await executeCloneArtifacts({ repositoryPath, worktreePath, preservePatterns });
    this.logger.info?.(
      `clone-artifacts for '${id}': ${outcome.status} in ${Date.now() - startedAt}ms`,
      {
        ...(outcome.status === 'succeeded'
          ? { engine: outcome.engine, entries: outcome.entries, warnings: outcome.warnings }
          : {}),
        ...(outcome.status === 'failed' ? { message: outcome.message } : {}),
      }
    );
    await this.updateBackgroundStep(id, 'cloneArtifacts', toStepState(outcome));
  }

  private async executePushStep(id: string, repositoryPath: string, branch: string): Promise<void> {
    await this.updateBackgroundStep(id, 'pushBranch', { status: 'running' });
    const outcome = await executePushBranch({ repositoryPath, branch });
    await this.updateBackgroundStep(id, 'pushBranch', toStepState(outcome));
  }

  private async executeFetchStep(
    id: string,
    repositoryPath: string,
    baseRef: string
  ): Promise<void> {
    const last = this.lastFetchAt.get(repositoryPath);
    const now = Date.now();
    if (last !== undefined && now - last < FETCH_DEBOUNCE_MS) {
      await this.updateBackgroundStep(id, 'fetchRefs', { status: 'skipped' });
      return;
    }
    this.lastFetchAt.set(repositoryPath, now);
    await this.updateBackgroundStep(id, 'fetchRefs', { status: 'running' });
    const outcome = await executeFetchRefs({ repositoryPath, baseRef });
    // Advisory by contract: a failed fetch is recorded, never surfaced as an error.
    await this.updateBackgroundStep(id, 'fetchRefs', toStepState(outcome));
  }

  /**
   * The activation artifact gate: resolves once the artifact clone settled (succeeded,
   * failed, or skipped — a terminal failure opens the gates anyway) so dependency-
   * consuming steps run against whatever exists. Incomplete durable state without an
   * in-flight run (post-restart) triggers a replay first.
   */
  private async awaitCloneArtifacts(id: string): Promise<void> {
    const record = this.store.get(id);
    if (!record?.background) return;
    if (!isIncomplete(record.background.steps.cloneArtifacts)) return;
    if (!this.cloneRuns.has(id)) void this.runBackgroundSteps(id);
    // A rejected clone run (e.g. a store write failure) still opens the gate —
    // dependents proceed and a real install is the graceful degradation.
    await (this.cloneRuns.get(id) ?? Promise.resolve()).catch(() => undefined);
  }

  /** Manual retry of a durably failed branch push — the one user-retryable step. */
  async retryPushBranch(
    input: RetryPushBranchInput
  ): Promise<Result<WorkspaceRecord, WorkspaceNotFoundError>> {
    const record = this.store.get(input.id);
    if (!record) {
      return err({ type: 'workspace-not-found', workspaceId: input.id });
    }
    const branch = record.creation?.branch ?? null;
    const parent = record.parentId === null ? null : this.store.get(record.parentId);
    // 'failed' is the only terminal state a retry re-runs; anything else (succeeded,
    // skipped, or an in-flight run) is a no-op returning the current record.
    if (record.background?.steps.pushBranch?.status === 'failed' && branch !== null && parent) {
      await this.executePushStep(input.id, parent.path, branch);
    }
    const current = this.store.get(input.id) ?? record;
    return ok(this.toWire(current));
  }

  /** Durable step-status writer; publishing folds the change into the records overlay. */
  private updateBackgroundStep(
    id: string,
    step: 'cloneArtifacts' | 'pushBranch' | 'fetchRefs',
    state: Omit<WorkspaceBackgroundStep, 'at'>
  ): Promise<void> {
    return this.enqueue(async () => {
      const record = this.store.get(id);
      if (!record?.background) return;
      const now = this.clock.now();
      const updated: DurableWorkspaceRecord = {
        ...record,
        background: {
          ...record.background,
          steps: { ...record.background.steps, [step]: { ...state, at: now } },
        },
        updatedAt: now,
      };
      this.store.update(updated);
      this.publish(updated);
    });
  }

  private logStageTimings(
    id: string,
    stageStarts: Array<{ stage: string; at: number }>,
    status: string
  ): void {
    const durations: Record<string, number> = {};
    const end = Date.now();
    for (let index = 0; index < stageStarts.length; index += 1) {
      const next = index + 1 < stageStarts.length ? stageStarts[index + 1]!.at : end;
      durations[stageStarts[index]!.stage] = next - stageStarts[index]!.at;
    }
    const total = stageStarts.length > 0 ? end - stageStarts[0]!.at : 0;
    this.logger.info?.(`createWorktree '${id}' ${status} in ${total}ms`, { stages: durations });
  }

  /** Overlay writes republish the merged record; an all-empty overlay reads as null. */
  private updateOverlay(
    id: string,
    mutate: (overlay: WorkspaceRuntimeOverlay) => WorkspaceRuntimeOverlay
  ): void {
    const current = this.overlays.get(id) ?? { creation: null, notices: [], activation: null };
    const next = mutate(current);
    if (next.creation === null && next.activation === null && next.notices.length === 0) {
      this.overlays.delete(id);
    } else {
      this.overlays.set(id, next);
    }
    const record = this.store.get(id);
    if (record) this.publish(record);
  }

  private deleteWorkspaceLocked(input: DeleteWorkspaceInput): Result<void, DeleteWorkspaceError> {
    const deleted = this.store.delete(input.id);
    if (deleted) {
      this.overlays.delete(input.id);
      this.untrackedCaches.delete(input.id);
      this.recordsCell.update((previous) => {
        const next = { ...previous };
        delete next[input.id];
        return next;
      });
      this.onRecordsChanged?.();
    } else {
      this.logger.debug?.(`delete of absent workspace '${input.id}' — idempotent no-op`);
    }
    return ok(undefined);
  }

  // -------------------------------------------------------------------------
  // Scan: the registry's reconciliation with the disk. The filesystem is the
  // source of truth — records follow it, never the other way around.
  // -------------------------------------------------------------------------

  private async refreshLocked(
    input: RefreshWorkspacesInput
  ): Promise<Result<void, WorkspaceNotFoundError>> {
    if (input.id !== undefined) {
      const record = this.store.get(input.id);
      if (!record) {
        return err({ type: 'workspace-not-found', workspaceId: input.id });
      }
      await this.scanRecord(record);
      return ok(undefined);
    }
    await this.scanHost();
    return ok(undefined);
  }

  async scanHost(): Promise<void> {
    const records = this.store.list();
    const repositories = records.filter((record) => record.kind === 'repository');
    const reconciledWorktreeIds = new Set<string>();

    for (const repository of repositories) {
      const childIds = await this.scanRepository(repository, records);
      for (const id of childIds) reconciledWorktreeIds.add(id);
    }

    // Records the repository pass did not cover: directories, and worktrees whose
    // parent repository is unknown, missing, or unscannable.
    for (const record of this.store.list()) {
      if (record.kind === 'repository' || reconciledWorktreeIds.has(record.id)) continue;
      await this.scanStandalone(record);
    }
  }

  private async scanRecord(record: DurableWorkspaceRecord): Promise<void> {
    if (record.kind === 'repository') {
      await this.scanRepository(record, this.store.list());
      return;
    }
    if (record.kind === 'worktree' && record.parentId !== null) {
      const parent = this.store.get(record.parentId);
      if (parent && (await isDirectory(parent.path))) {
        // Reconcile through the owning repository so relinks and locked/prunable land.
        await this.scanRepository(parent, this.store.list());
        return;
      }
    }
    await this.scanStandalone(record);
  }

  /**
   * Reconciles one present repository and its worktrees with the disk. Returns the ids
   * of every worktree record it settled (so the host scan skips them).
   */
  private async scanRepository(
    repository: DurableWorkspaceRecord,
    records: DurableWorkspaceRecord[]
  ): Promise<Set<string>> {
    const settled = new Set<string>();
    const now = this.clock.now();

    if (!(await isDirectory(repository.path))) {
      this.recordVanished(repository, now);
      return settled;
    }

    let listings: WorktreeListing[];
    try {
      listings = await listRepositoryWorktrees(repository.path);
    } catch (error) {
      // Positive assertion: an unscannable repository degrades its own observations and
      // asserts nothing about its worktrees.
      this.logger.warn?.(
        `workspace registry scan of '${repository.path}' failed: ${String(error)}`
      );
      this.saveRecord({ ...repository, observedStatus: 'present', git: null }, now);
      return settled;
    }

    const children = records.filter(
      (record) => record.kind === 'worktree' && record.parentId === repository.id
    );
    const childByPath = new Map(children.map((child) => [child.path, child]));
    const childByAdminName = new Map(
      children.flatMap((child) => (child.gitAdminName ? [[child.gitAdminName, child]] : []))
    );

    for (const listing of listings) {
      if (listing.isMain) continue;
      const canonicalPath = await realpathSafe(listing.path);
      if (!(await isDirectory(canonicalPath))) {
        // Prunable admin debris without a directory: nothing to track.
        continue;
      }

      const byPath = childByPath.get(canonicalPath);
      const byAdmin = listing.adminName ? childByAdminName.get(listing.adminName) : undefined;
      const child = byPath ?? byAdmin;
      if (child) {
        settled.add(child.id);
        this.saveRecord(
          {
            ...child,
            // Moved worktrees relink by admin name: identity survives, path follows.
            path: canonicalPath,
            gitAdminName: listing.adminName ?? child.gitAdminName,
            observedStatus: 'present',
            git: await observeWorkspaceGit(canonicalPath, listing, {
              untrackedCache: this.untrackedCacheFor(child.id),
            }),
          },
          now
        );
        continue;
      }

      // Host-discovered worktree of a registered repository: adopt under a host-minted id.
      const adoptedId = crypto.randomUUID();
      const adopted: DurableWorkspaceRecord = {
        id: adoptedId,
        kind: 'worktree',
        path: canonicalPath,
        parentId: repository.id,
        origin: 'adopted',
        gitAdminName: listing.adminName ?? null,
        observedStatus: 'present',
        creation: null,
        lastCreateOutcome: null,
        background: null,
        lastRemovalAttempt: null,
        scriptOutcomes: null,
        git: await observeWorkspaceGit(canonicalPath, listing, {
          untrackedCache: this.untrackedCacheFor(adoptedId),
        }),
        lastActivatedAt: null,
        createdAt: now,
        updatedAt: now,
        lastObservedAt: now,
      };
      settled.add(adopted.id);
      this.store.insert(adopted);
      this.publish(adopted);
    }

    for (const child of children) {
      if (settled.has(child.id)) continue;
      settled.add(child.id);
      if (await isDirectory(child.path)) {
        // On disk but no longer listed by the repository (e.g. pruned admin data):
        // observe it directly rather than asserting it gone.
        this.saveRecord(
          {
            ...child,
            observedStatus: 'present',
            git: await observeWorkspaceGit(child.path, undefined, {
              untrackedCache: this.untrackedCacheFor(child.id),
            }),
          },
          now
        );
      } else {
        this.recordVanished(child, now);
      }
    }

    this.saveRecord(
      {
        ...repository,
        observedStatus: 'present',
        git: await observeWorkspaceGit(repository.path, undefined, {
          untrackedCache: this.untrackedCacheFor(repository.id),
        }),
      },
      now
    );
    return settled;
  }

  /** The cheap scan path: ref-only change — no status, no untracked counting. */
  private async scanRefsOnly(record: DurableWorkspaceRecord): Promise<void> {
    const now = this.clock.now();
    if (record.kind === 'directory') return;
    if (!(await isDirectory(record.path))) {
      this.recordVanished(record, now);
      return;
    }
    const git = await observeWorkspaceGitRefs(record.path, record.git);
    this.saveRecord({ ...record, observedStatus: 'present', git }, now);
  }

  /** Presence + observations for a record outside any repository reconciliation. */
  private async scanStandalone(record: DurableWorkspaceRecord): Promise<void> {
    const now = this.clock.now();
    if (!(await isDirectory(record.path))) {
      this.recordVanished(record, now);
      return;
    }
    const git =
      record.kind === 'directory'
        ? null
        : await observeWorkspaceGit(record.path, undefined, {
            untrackedCache: this.untrackedCacheFor(record.id),
          });
    this.saveRecord({ ...record, observedStatus: 'present', git }, now);
  }

  /** Adopted records follow the disk; registered records survive as 'missing'. */
  private recordVanished(record: DurableWorkspaceRecord, now: number): void {
    this.untrackedCaches.delete(record.id);
    if (record.origin === 'adopted') {
      this.deleteWorkspaceLocked({ id: record.id });
      return;
    }
    this.saveRecord({ ...record, observedStatus: 'missing', git: null }, now);
  }

  private untrackedCacheFor(id: string): UntrackedLinesCache {
    let cache = this.untrackedCaches.get(id);
    if (!cache) {
      cache = createUntrackedLinesCache();
      this.untrackedCaches.set(id, cache);
    }
    return cache;
  }

  /** Persists a scan result, stamping observation time and bumping updatedAt on change. */
  private saveRecord(next: DurableWorkspaceRecord, now: number): void {
    const previous = this.store.get(next.id);
    const changed =
      !previous || JSON.stringify(recordEssence(previous)) !== JSON.stringify(recordEssence(next));
    const record: DurableWorkspaceRecord = {
      ...next,
      updatedAt: changed ? now : (previous?.updatedAt ?? now),
      lastObservedAt: now,
    };
    this.store.update(record);
    this.publish(record);
  }

  /**
   * Registering a worktree of an unregistered repository auto-registers the parent as
   * adopted (host-minted id) so `parentId` always resolves.
   */
  private ensureRepositoryRegistered(repositoryPath: string, now: number): string {
    const existing = this.store.getByPath(repositoryPath);
    if (existing) return existing.id;

    const parent: DurableWorkspaceRecord = {
      id: crypto.randomUUID(),
      kind: 'repository',
      path: repositoryPath,
      parentId: null,
      origin: 'adopted',
      gitAdminName: null,
      observedStatus: 'present',
      creation: null,
      lastCreateOutcome: null,
      background: null,
      lastRemovalAttempt: null,
      scriptOutcomes: null,
      git: null,
      lastActivatedAt: null,
      createdAt: now,
      updatedAt: now,
      lastObservedAt: now,
    };
    this.store.insert(parent);
    this.publish(parent);
    return parent.id;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation, operation);
    this.mutationQueue = next.catch(() => undefined);
    return next;
  }

  private publish(record: DurableWorkspaceRecord): void {
    const wire = this.toWire(record);
    this.recordsCell.update((previous) => ({ ...previous, [record.id]: wire }));
    this.onRecordsChanged?.();
  }

  private toWire(record: DurableWorkspaceRecord): WorkspaceRecord {
    const overlay = this.overlays.get(record.id);
    const background = record.background?.steps ?? null;
    // The durable background section rides the overlay so clients keep one progress
    // surface; unlike the rest of the overlay it survives daemon restarts.
    const runtime =
      overlay !== undefined || background !== null
        ? {
            creation: overlay?.creation ?? null,
            notices: overlay?.notices ?? [],
            activation: overlay?.activation ?? null,
            background,
          }
        : null;
    return { ...record, runtime };
  }
}

const FETCH_DEBOUNCE_MS = 5 * 60_000;

/** Pending/running steps are incomplete and replay; terminal statuses never re-run. */
function isIncomplete(step: WorkspaceBackgroundStep | null): boolean {
  return step !== null && (step.status === 'pending' || step.status === 'running');
}

function hasIncompleteBackgroundSteps(record: DurableWorkspaceRecord): boolean {
  if (!record.background || record.lastCreateOutcome?.status !== 'succeeded') return false;
  const steps = record.background.steps;
  return (
    isIncomplete(steps.cloneArtifacts) ||
    isIncomplete(steps.pushBranch) ||
    isIncomplete(steps.fetchRefs)
  );
}

function toStepState(outcome: {
  status: 'succeeded' | 'skipped' | 'failed';
  message?: string;
  reason?: string;
}): Omit<WorkspaceBackgroundStep, 'at'> {
  if (outcome.status === 'failed') return { status: 'failed', message: outcome.message };
  if (outcome.status === 'skipped') return { status: 'skipped', message: outcome.reason };
  return { status: 'succeeded' };
}

/** The change-detection view of a record: everything except the bookkeeping stamps. */
function recordEssence(
  record: DurableWorkspaceRecord
): Omit<DurableWorkspaceRecord, 'updatedAt' | 'lastObservedAt'> {
  const { updatedAt: _updatedAt, lastObservedAt: _lastObservedAt, ...essence } = record;
  return essence;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function realpathSafe(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return target;
  }
}
