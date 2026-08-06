import { hostRefKey, type HostRef } from '@emdash/core/primitives/host/api';
import type { Scope } from '@emdash/shared/concurrency';
import { startPeriodicSweep } from '@core/primitives/periodic-sweep/node/periodic-sweep';

/**
 * The entity-generic reconcile sweep (ADR 0006, spec §2): tombstoned mirror rows are
 * the durable deletion queue, and this service converges them whenever their host is
 * reachable by calling each registered kind's idempotent removal function. The RPC
 * return is loop control only — it schedules per-item backoff or not; the tombstone
 * purges when the sync-delivered mirror confirms the host record gone (the snapshot
 * application untracks it), never on the RPC return. Failure classes are host-written
 * on the record: transient failures ride the 10-minute backstop with exponential
 * per-item backoff; terminal ones stop auto-retry until the user chooses Retry or
 * Untrack-anyway. The only client-side coordination is the per-tombstone in-memory
 * single-flight marker — no admission guard, no claims.
 */

/** One tombstoned mirror row, as the sweep needs to see it — kind-agnostic. */
export type ReconcileTombstone = {
  /** The tombstoned record's UUID: the per-tombstone single-flight and backoff key. */
  id: string;
  /** Epoch-ms tombstone write stamp; marks older than this never block the intent. */
  tombstonedAt: number;
  /** Host-written outcome mark mirrored from the record; 'terminal' needs the user. */
  lastRemovalAttempt: { class: 'transient' | 'terminal'; at: number } | null;
};

export type RemovalAttemptOutcome =
  /** The RPC finished; it asserts nothing — the purge waits on mirror confirmation. */
  | 'ok'
  /** The verb failed on a reachable host: schedule per-item backoff. */
  | 'failed'
  /** The host could not be reached: not an attempt, no backoff; reconnect retries. */
  | 'unreachable';

/**
 * One entity kind's contribution: a small object, not inheritance. Each registry
 * (workspaces now, conversations in a later slice) supplies how to read its pending
 * tombstones for a host, how to execute its idempotent removal verb with the frozen
 * options, and how to tell that the mirror has confirmed the host record gone.
 */
export type ReconcileSweepKind = {
  /** Unique registry name; kinds sweep in registration order (churn heuristic only). */
  readonly kind: string;
  /** Live tombstoned mirror rows for one host — the durable queue. */
  readTombstones(host: HostRef): Promise<readonly ReconcileTombstone[]>;
  /**
   * Call the owning surface's idempotent removal verb with the tombstone's frozen
   * options. Must be safe to re-issue and to run against rows vanishing underneath
   * (forget-host); the return is loop control, never truth.
   */
  executeRemoval(host: HostRef, id: string): Promise<RemovalAttemptOutcome>;
  /** Sync-plane confirmation: the mirror no longer serves a live row for the id. */
  confirmGone(host: HostRef, id: string): Promise<boolean>;
};

/** The slice the wire controller needs for the Retry / Untrack-anyway affordances. */
export type ReconcileSweepHandle = Pick<ReconcileSweepService, 'retry' | 'drop'>;

export interface ReconcileSweepServiceOptions {
  scope: Scope;
  /** Backstop cadence; the retry vehicle (spec §2). Defaults to 10 minutes. */
  backstopIntervalMs?: number;
  /** Test seam for backoff arithmetic. */
  now?: () => number;
  onError?: (context: string, error: unknown) => void;
}

const BACKSTOP_INTERVAL_MS = 10 * 60 * 1000;
const BACKOFF_BASE_MS = 60 * 1000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;

type ItemState = {
  kind: string;
  id: string;
  hostKey: string;
  /** Consecutive failed attempts; drives the exponential window. */
  failures: number;
  /** Epoch-ms; attempts inside the window are skipped (the backstop retries later). */
  nextAttemptAt: number;
  /** Set by Retry: terminal marks at or before this stamp no longer stop the item. */
  retryClearedAt?: number;
};

export class ReconcileSweepService {
  private readonly kinds: ReconcileSweepKind[] = [];
  private readonly hosts = new Map<string, HostRef>();
  private readonly states = new Map<string, ItemState>();
  private readonly inFlight = new Set<string>();
  private readonly now: () => number;
  private disposed = false;

  constructor(private readonly options: ReconcileSweepServiceOptions) {
    this.now = options.now ?? Date.now;
    startPeriodicSweep({
      scope: options.scope,
      intervalMs: options.backstopIntervalMs ?? BACKSTOP_INTERVAL_MS,
      run: () => this.sweepAll(),
      onError: (error) => options.onError?.('reconcile sweep backstop', error),
    });
    options.scope.add(() => {
      this.disposed = true;
    });
  }

  registerKind(kind: ReconcileSweepKind): void {
    this.kinds.push(kind);
  }

  /** Reachability signal: the host's runtime is up. Triggers an immediate sweep. */
  attachHost(host: HostRef): void {
    if (this.disposed) return;
    this.hosts.set(hostRefKey(host), host);
    void this.sweepHost(host);
  }

  /** Backoff state survives detach: a failure window outlives a reachability flap. */
  detachHost(host: HostRef): void {
    this.hosts.delete(hostRefKey(host));
  }

  /** The backstop: sweeps reachable hosts only; tombstones for others sit inert. */
  async sweepAll(): Promise<void> {
    for (const host of [...this.hosts.values()]) {
      await this.sweepHost(host);
    }
  }

  /**
   * One sweep pass over a host's tombstones, all kinds in registration order.
   * Overlapping passes are safe: the per-tombstone single-flight marker suppresses
   * duplicate RPCs, and rows vanishing mid-pass (forget-host, sync purge) are benign.
   */
  async sweepHost(host: HostRef): Promise<void> {
    if (this.disposed) return;
    const hostKey = hostRefKey(host);
    for (const kind of this.kinds) {
      let items: readonly ReconcileTombstone[];
      try {
        items = await kind.readTombstones(host);
      } catch (error) {
        this.options.onError?.(`reconcile sweep read (${kind.kind})`, error);
        continue;
      }
      this.pruneStates(kind.kind, hostKey, items);
      for (const item of items) {
        await this.sweepItem(kind, host, hostKey, item);
      }
    }
  }

  /**
   * Retry affordance (ADR 0006): clears the terminal stop and the backoff window so
   * the next sweep retries, and sweeps the host immediately.
   */
  retry(kind: string, host: HostRef, id: string): void {
    if (this.disposed) return;
    const state = this.stateFor(kind, id, hostRefKey(host));
    state.retryClearedAt = this.now();
    state.failures = 0;
    state.nextAttemptAt = 0;
    void this.sweepHost(host);
  }

  /** Untrack-anyway affordance: the tombstone is purged client-side; forget it here. */
  drop(kind: string, id: string): void {
    this.states.delete(stateKey(kind, id));
  }

  private async sweepItem(
    kind: ReconcileSweepKind,
    host: HostRef,
    hostKey: string,
    item: ReconcileTombstone
  ): Promise<void> {
    const key = stateKey(kind.kind, item.id);
    if (this.inFlight.has(key)) return;
    const state = this.states.get(key);
    if (isTerminallyStopped(item, state)) return;
    if (state !== undefined && this.now() < state.nextAttemptAt) return;

    this.inFlight.add(key);
    try {
      // Re-check under the marker: sync or forget-host may have purged the row
      // between the read and this attempt — converged, nothing to issue.
      if (await kind.confirmGone(host, item.id)) {
        this.states.delete(key);
        return;
      }
      const outcome = await kind.executeRemoval(host, item.id);
      if (outcome === 'failed') {
        const failed = this.stateFor(kind.kind, item.id, hostKey);
        failed.failures += 1;
        failed.nextAttemptAt = this.now() + backoffWindowMs(failed.failures);
      } else if (outcome === 'ok') {
        const succeeded = this.stateFor(kind.kind, item.id, hostKey);
        succeeded.failures = 0;
        succeeded.nextAttemptAt = 0;
      }
      // 'unreachable' is not an attempt: no backoff; the reconnect trigger retries.
    } catch (error) {
      const failed = this.stateFor(kind.kind, item.id, hostKey);
      failed.failures += 1;
      failed.nextAttemptAt = this.now() + backoffWindowMs(failed.failures);
      this.options.onError?.(`reconcile sweep removal (${kind.kind})`, error);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private stateFor(kind: string, id: string, hostKey: string): ItemState {
    const key = stateKey(kind, id);
    const existing = this.states.get(key);
    if (existing !== undefined) return existing;
    const created: ItemState = { kind, id, hostKey, failures: 0, nextAttemptAt: 0 };
    this.states.set(key, created);
    return created;
  }

  /** In-memory bookkeeping follows the store: purged/forgotten rows leave no state. */
  private pruneStates(kind: string, hostKey: string, items: readonly ReconcileTombstone[]): void {
    const live = new Set(items.map((item) => item.id));
    for (const [key, state] of this.states) {
      if (state.kind !== kind || state.hostKey !== hostKey) continue;
      if (!live.has(state.id) && !this.inFlight.has(key)) this.states.delete(key);
    }
  }
}

function stateKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

/**
 * The terminal-failure stop (spec §2): host-written 'terminal' marks halt auto-retry.
 * A mark older than the tombstone belongs to a previous intent and never blocks the
 * fresh one; a mark at or before the user's Retry click is considered cleared.
 */
function isTerminallyStopped(item: ReconcileTombstone, state: ItemState | undefined): boolean {
  const mark = item.lastRemovalAttempt;
  if (mark === null || mark.class !== 'terminal') return false;
  if (mark.at < item.tombstonedAt) return false;
  if (state?.retryClearedAt !== undefined && mark.at <= state.retryClearedAt) return false;
  return true;
}

function backoffWindowMs(failures: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1));
}
