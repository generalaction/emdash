import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { err, ok, type Result } from '@emdash/shared';
import { noopLogger, type Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { cell, expose, type Cell, type LeasedLiveModelProvider } from '@emdash/wire';
import type { StoreHandle } from '@primitives/sqlite-store/api';
import { workspaceRegistryContract } from '../api/contract';
import type {
  CreateWorkspaceError,
  DeleteWorkspaceError,
  WorkspaceNotFoundError,
} from '../api/errors';
import type {
  CreateWorkspaceInput,
  DeleteWorkspaceInput,
  RefreshWorkspacesInput,
  WorkspaceRecord,
  WorkspaceRecords,
  WorkspaceRuntimeOverlay,
} from '../api/schemas';
import {
  canonicalizeWorkspacePath,
  inspectWorkspacePath,
  type PathInspector,
} from './inspect-path';
import { WorkspaceRecordStore, type DurableWorkspaceRecord } from './persistence/record-store';
import type { WorkspaceRegistryDb } from './persistence/store';
import {
  listRepositoryWorktrees,
  observeWorkspaceGit,
  observeWorkspaceGitRefs,
  type WorktreeListing,
} from './scan/observe-git';
import type { ScanRequest, ScanTarget } from './scan/scheduler';

export type WorkspaceRegistryRuntimeOptions = {
  handle: StoreHandle<WorkspaceRegistryDb>;
  clock?: Clock;
  logger?: Logger;
  /** Test seam for hosts without git; production always inspects the real filesystem. */
  inspector?: PathInspector;
  /** Invoked after every records change; the component points the scheduler at it. */
  onRecordsChanged?: () => void;
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
  readonly recordsHost: LeasedLiveModelProvider<typeof workspaceRegistryContract.records>;

  constructor(options: WorkspaceRegistryRuntimeOptions) {
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? noopLogger;
    this.inspector = options.inspector ?? inspectWorkspacePath;
    this.onRecordsChanged = options.onRecordsChanged;
    this.store = new WorkspaceRecordStore(options.handle);

    const initial: WorkspaceRecords = {};
    for (const record of this.store.list()) {
      initial[record.id] = this.toWire(record);
    }
    this.recordsCell = cell<WorkspaceRecords>(initial, { name: 'workspace-records' });
    this.recordsHost = expose(workspaceRegistryContract.records, {
      list: () => this.recordsCell,
    });
  }

  dispose(): void {
    this.recordsHost.dispose();
  }

  createWorkspace(
    input: CreateWorkspaceInput
  ): Promise<Result<WorkspaceRecord, CreateWorkspaceError>> {
    return this.enqueue(() => this.createWorkspaceLocked(input));
  }

  deleteWorkspace(input: DeleteWorkspaceInput): Promise<Result<void, DeleteWorkspaceError>> {
    return this.enqueue(() => Promise.resolve(this.deleteWorkspaceLocked(input)));
  }

  refresh(input: RefreshWorkspacesInput): Promise<Result<void, WorkspaceNotFoundError>> {
    return this.enqueue(() => this.refreshLocked(input));
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

  private deleteWorkspaceLocked(input: DeleteWorkspaceInput): Result<void, DeleteWorkspaceError> {
    const deleted = this.store.delete(input.id);
    if (deleted) {
      this.overlays.delete(input.id);
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
            git: await observeWorkspaceGit(canonicalPath, listing),
          },
          now
        );
        continue;
      }

      // Host-discovered worktree of a registered repository: adopt under a host-minted id.
      const adopted: DurableWorkspaceRecord = {
        id: crypto.randomUUID(),
        kind: 'worktree',
        path: canonicalPath,
        parentId: repository.id,
        origin: 'adopted',
        gitAdminName: listing.adminName ?? null,
        observedStatus: 'present',
        creation: null,
        lastCreateOutcome: null,
        git: await observeWorkspaceGit(canonicalPath, listing),
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
          { ...child, observedStatus: 'present', git: await observeWorkspaceGit(child.path) },
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
        git: await observeWorkspaceGit(repository.path),
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
    const git = record.kind === 'directory' ? null : await observeWorkspaceGit(record.path);
    this.saveRecord({ ...record, observedStatus: 'present', git }, now);
  }

  /** Adopted records follow the disk; registered records survive as 'missing'. */
  private recordVanished(record: DurableWorkspaceRecord, now: number): void {
    if (record.origin === 'adopted') {
      this.deleteWorkspaceLocked({ id: record.id });
      return;
    }
    this.saveRecord({ ...record, observedStatus: 'missing', git: null }, now);
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
    return { ...record, runtime: this.overlays.get(record.id) ?? null };
  }
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
