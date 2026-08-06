import path from 'node:path';
import { noopLogger, type Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import type { IWatchService, WatchEvent, WatchHandle } from '@services/fs-watch/api';
import type { WorkspaceKind } from '../../api/schemas';

/** What the scheduler asks the runtime to do. Repository scans reconcile worktree sets. */
export type ScanRequest =
  | { kind: 'repository'; id: string }
  | { kind: 'workspace'; id: string; mode: 'full' | 'refs' };

/** The scheduler's view of one registry record. */
export type ScanTarget = {
  id: string;
  kind: WorkspaceKind;
  path: string;
  parentId: string | null;
  observedStatus: 'present' | 'missing';
  lastObservedAt: number;
};

export type WorkspaceScanSchedulerOptions = {
  /** Null when the host has no watcher; the polling floor then carries freshness alone. */
  watcher: IWatchService | null;
  execute: (request: ScanRequest) => Promise<void>;
  listTargets: () => ScanTarget[];
  /** Activity escalation gate: active workspaces coalesce on a shorter debounce. */
  isActive: (id: string) => boolean;
  clock?: Clock;
  logger?: Logger;
  debounceMs?: number;
  activeDebounceMs?: number;
  /** The freshness floor: no record goes longer than this without a rescan. */
  pollIntervalMs?: number;
};

export const DEFAULT_SCAN_DEBOUNCE_MS = 2_000;
/**
 * Active workspaces coalesce on 1 s: task-card badges trailing a write burst
 * by ≤1 s + scan time is imperceptible, and the steady-state subprocess load
 * during agent write bursts drops to roughly a quarter of the previous 250 ms.
 */
export const DEFAULT_ACTIVE_SCAN_DEBOUNCE_MS = 1_000;
const DEFAULT_POLL_INTERVAL_MS = 5 * 60_000;

type PendingScan = {
  request: ScanRequest;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Event-driven freshness for the workspace registry (ADR 0005): fs events are the
 * primary trigger, classified into cheap ref-only scans vs full scans; rapid triggers
 * coalesce per record (full beats refs); a polling floor guarantees staleness is bounded
 * even when watchers fail. The scheduler never writes the registry — it only asks the
 * sole-writer runtime to scan.
 */
export class WorkspaceScanScheduler {
  private readonly watcher: IWatchService | null;
  private readonly execute: (request: ScanRequest) => Promise<void>;
  private readonly listTargets: () => ScanTarget[];
  private readonly isActive: (id: string) => boolean;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly debounceMs: number;
  private readonly activeDebounceMs: number;
  private readonly pollIntervalMs: number;

  private readonly watches = new Map<string, WatchHandle>();
  private readonly pending = new Map<string, PendingScan>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly rerunAfterFlight = new Map<string, ScanRequest>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(options: WorkspaceScanSchedulerOptions) {
    this.watcher = options.watcher;
    this.execute = options.execute;
    this.listTargets = options.listTargets;
    this.isActive = options.isActive;
    this.clock = options.clock ?? systemClock;
    this.logger = options.logger ?? noopLogger;
    this.debounceMs = options.debounceMs ?? DEFAULT_SCAN_DEBOUNCE_MS;
    this.activeDebounceMs = options.activeDebounceMs ?? DEFAULT_ACTIVE_SCAN_DEBOUNCE_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  start(): void {
    this.syncWatches();
    this.pollTimer = setInterval(() => this.pollFloor(), this.pollIntervalMs);
    this.pollTimer.unref?.();
  }

  /** Called by the runtime after every records change: reconciles watches with targets. */
  syncWatches(): void {
    if (this.disposed || this.watcher === null) return;
    const desired = new Map<string, { target: ScanTarget; gitDir: boolean }>();
    for (const target of this.listTargets()) {
      if (target.observedStatus !== 'present') continue;
      desired.set(workingTreeWatchKey(target.path), { target, gitDir: false });
      if (target.kind === 'repository') {
        desired.set(gitDirWatchKey(target.path), { target, gitDir: true });
      }
    }

    for (const [key, handle] of this.watches) {
      if (!desired.has(key)) {
        this.watches.delete(key);
        void handle.release().catch(() => undefined);
      }
    }
    for (const [key, { target, gitDir }] of desired) {
      if (this.watches.has(key)) continue;
      const handle = gitDir
        ? this.watcher.watch(
            path.join(target.path, '.git'),
            (events) => this.onGitDirEvents(target.id, target.path, events),
            { onResync: () => this.request({ kind: 'repository', id: target.id }) }
          )
        : this.watcher.watch(
            target.path,
            () => this.request({ kind: 'workspace', id: target.id, mode: 'full' }),
            {
              ignore: ['.git/**'],
              onResync: () => this.request({ kind: 'workspace', id: target.id, mode: 'full' }),
            }
          );
      this.watches.set(key, handle);
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    const handles = [...this.watches.values()];
    this.watches.clear();
    await Promise.allSettled(handles.map((handle) => handle.release()));
    await Promise.allSettled([...this.inFlight.values()]);
  }

  /** Classifies events inside a repository's git dir (refs vs index vs worktree admin). */
  private onGitDirEvents(repositoryId: string, repositoryPath: string, events: WatchEvent[]): void {
    const gitDir = path.join(repositoryPath, '.git');
    let refs = false;
    let full = false;
    let worktrees = false;
    for (const event of events) {
      const rel = path.relative(gitDir, event.path).replace(/\\/g, '/');
      if (rel.startsWith('..')) continue;
      if (rel === 'FETCH_HEAD' || rel === 'ORIG_HEAD') {
        // Rewritten on every fetch/reset even when nothing changed — ignoring them
        // stops the 2-minute background fetch from fanning refs scans across every
        // worktree. A real ref update still arrives via refs/remotes/* or packed-refs.
        continue;
      }
      if (rel.startsWith('worktrees/') || rel === 'worktrees') {
        worktrees = true;
      } else if (rel === 'index') {
        full = true;
      } else {
        // refs/, HEAD, packed-refs, config, logs — all cheap-path triggers.
        refs = true;
      }
    }
    if (worktrees) {
      // Worktree admin data changed: membership may have changed — reconcile the repo.
      this.request({ kind: 'repository', id: repositoryId });
      return;
    }
    if (full) {
      this.request({ kind: 'workspace', id: repositoryId, mode: 'full' });
      return;
    }
    if (refs) {
      this.request({ kind: 'workspace', id: repositoryId, mode: 'refs' });
      // Branch tips moved: every worktree's ahead/behind may have changed.
      for (const target of this.listTargets()) {
        if (target.parentId === repositoryId && target.observedStatus === 'present') {
          this.request({ kind: 'workspace', id: target.id, mode: 'refs' });
        }
      }
    }
  }

  private request(request: ScanRequest): void {
    if (this.disposed) return;
    const key = request.id;

    if (this.inFlight.has(key)) {
      this.rerunAfterFlight.set(key, mergeRequests(this.rerunAfterFlight.get(key), request));
      return;
    }

    const existing = this.pending.get(key);
    if (existing) {
      existing.request = mergeRequests(existing.request, request);
      return;
    }

    const debounce = this.isActive(request.id) ? this.activeDebounceMs : this.debounceMs;
    const timer = setTimeout(() => this.fire(key), debounce);
    timer.unref?.();
    this.pending.set(key, { request, timer });
  }

  private fire(key: string): void {
    const pending = this.pending.get(key);
    if (!pending || this.disposed) return;
    this.pending.delete(key);

    const flight = this.execute(pending.request)
      .catch((error) => this.logger.warn?.(`workspace scan failed: ${String(error)}`))
      .finally(() => {
        this.inFlight.delete(key);
        const rerun = this.rerunAfterFlight.get(key);
        if (rerun) {
          this.rerunAfterFlight.delete(key);
          this.request(rerun);
        }
      });
    this.inFlight.set(key, flight);
  }

  /** The staleness bound: rescan anything the event path has not touched recently. */
  private pollFloor(): void {
    const cutoff = this.clock.now() - this.pollIntervalMs;
    for (const target of this.listTargets()) {
      if (target.lastObservedAt > cutoff) continue;
      this.request(
        target.kind === 'repository'
          ? { kind: 'repository', id: target.id }
          : { kind: 'workspace', id: target.id, mode: 'full' }
      );
    }
  }
}

/** Full scans subsume ref scans; repository reconciliation subsumes both. */
function mergeRequests(previous: ScanRequest | undefined, next: ScanRequest): ScanRequest {
  if (!previous) return next;
  if (previous.kind === 'repository' || next.kind === 'repository') {
    return { kind: 'repository', id: next.id };
  }
  if (previous.mode === 'full' || next.mode === 'full') {
    return { kind: 'workspace', id: next.id, mode: 'full' };
  }
  return next;
}

function workingTreeWatchKey(workspacePath: string): string {
  return `tree:${workspacePath}`;
}

function gitDirWatchKey(workspacePath: string): string {
  return `git:${workspacePath}`;
}
