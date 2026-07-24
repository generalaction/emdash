import type { AutomationRun, GetRunOverviewResult } from '@emdash/core/runtimes/automations/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

export type RunHistoryFilter = 'all' | 'done' | 'failed' | 'skipped' | 'cancelled';

type HistoryState = {
  ids: string[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
  error: Error | null;
};

const EMPTY_COUNTS: GetRunOverviewResult['counts'] = {
  scheduled: 0,
  queued: 0,
  provisioning_workspace: 0,
  starting_session: 0,
  done: 0,
  failed: 0,
  skipped: 0,
  cancelled: 0,
};

export class AutomationRunStore {
  private readonly runs = new Map<string, AutomationRun>();
  private readonly histories = new Map<RunHistoryFilter, HistoryState>();
  private readonly listeners = new Set<() => void>();
  private cursor = 0;
  private version = 0;
  private references = 0;
  private hasConnected = false;
  private unsubscribe: (() => void) | undefined;
  private connecting: Promise<void> | undefined;
  private catchUpPromise: Promise<void> | undefined;
  private overview: GetRunOverviewResult = {
    counts: { ...EMPTY_COUNTS },
    latestRun: null,
    nextScheduledRun: null,
  };
  private overviewLoading = false;
  private overviewRefreshQueued = false;
  private overviewPromise: Promise<void> | undefined;
  private overviewError: Error | null = null;

  constructor(
    readonly projectId: string,
    readonly automationId: string
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  acquire(): () => void {
    this.references += 1;
    if (this.references === 1) this.ensureConnected();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.references -= 1;
      if (this.references === 0) {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
      }
    };
  }

  history(filter: RunHistoryFilter): AutomationRun[] {
    return (this.histories.get(filter)?.ids ?? []).flatMap((id) => {
      const run = this.runs.get(id);
      return run ? [run] : [];
    });
  }

  historyState(filter: RunHistoryFilter): Omit<HistoryState, 'ids'> {
    const state = this.ensureHistory(filter);
    return {
      hasMore: state.hasMore,
      loading: state.loading,
      loaded: state.loaded,
      error: state.error,
    };
  }

  get counts(): GetRunOverviewResult['counts'] {
    return this.overview.counts;
  }

  get latestRun(): AutomationRun | null {
    return this.overview.latestRun;
  }

  get nextScheduledRun(): AutomationRun | null {
    return this.overview.nextScheduledRun;
  }

  get overviewState(): { loading: boolean; error: Error | null } {
    return { loading: this.overviewLoading, error: this.overviewError };
  }

  run(runId: string): AutomationRun | undefined {
    return this.runs.get(runId);
  }

  async loadInitialHistory(filter: RunHistoryFilter, limit: number): Promise<void> {
    const state = this.ensureHistory(filter);
    if (state.loaded || state.loading) return;
    await this.loadHistoryPage(filter, limit, true);
  }

  async loadMoreHistory(filter: RunHistoryFilter, limit: number): Promise<void> {
    const state = this.ensureHistory(filter);
    if (state.loading || (state.loaded && !state.hasMore)) return;
    await this.loadHistoryPage(filter, limit, false);
  }

  async refreshOverview(): Promise<void> {
    this.overviewRefreshQueued = true;
    if (!this.overviewPromise) {
      this.overviewPromise = this.refreshOverviewLoop().finally(() => {
        this.overviewPromise = undefined;
      });
    }
    return this.overviewPromise;
  }

  private async connect(): Promise<void> {
    const reconnectCursor = this.cursor;
    const reconnecting = this.hasConnected;
    const client = await getDesktopWireClient();
    const unsubscribe = await client.automations.runEvents.subscribe(
      { projectId: this.projectId, automationId: this.automationId },
      {
        onEvent: ({ run }) => {
          const knownRun = this.runs.has(run.id);
          if (this.merge(run, knownRun)) this.applyRunToLoadedHistories(run);
          if (!knownRun || this.overviewLoading) void this.refreshOverview();
        },
        onGap: () => {
          void this.catchUp(this.cursor).catch((error) => {
            this.overviewError = asError(error);
            this.notify();
          });
        },
      }
    );
    if (this.references === 0) unsubscribe();
    else this.unsubscribe = unsubscribe;
    this.hasConnected = true;
    if (reconnecting) await this.catchUp(reconnectCursor);
    else await this.refreshOverview();
  }

  private ensureConnected(): void {
    if (this.unsubscribe || this.connecting) return;
    const connecting = this.connect()
      .catch((error) => {
        this.overviewError = asError(error);
        this.notify();
      })
      .finally(() => {
        if (this.connecting === connecting) this.connecting = undefined;
      });
    this.connecting = connecting;
  }

  private catchUp(sinceSeq: number): Promise<void> {
    this.catchUpPromise ??= this.catchUpOnce(sinceSeq).finally(() => {
      this.catchUpPromise = undefined;
    });
    return this.catchUpPromise;
  }

  private async catchUpOnce(initialSeq: number): Promise<void> {
    const client = await getDesktopWireClient();
    let sinceSeq = initialSeq;
    for (;;) {
      const result = await client.automations.listChangedRuns({
        projectId: this.projectId,
        automationId: this.automationId,
        sinceSeq,
      });
      if (!result.success) throw new Error(result.error.message);
      for (const run of result.data.runs) {
        if (this.merge(run)) this.applyRunToLoadedHistories(run);
      }
      if (result.data.nextSeq <= sinceSeq || result.data.runs.length === 0) break;
      sinceSeq = result.data.nextSeq;
    }
    await this.refreshOverview();
  }

  private async refreshOverviewLoop(): Promise<void> {
    while (this.overviewRefreshQueued) {
      this.overviewRefreshQueued = false;
      this.overviewLoading = true;
      this.overviewError = null;
      this.notify();
      try {
        const client = await getDesktopWireClient();
        const result = await client.automations.getRunOverview({
          projectId: this.projectId,
          automationId: this.automationId,
        });
        if (!result.success) throw new Error(result.error.message);
        this.overview = result.data;
        if (result.data.latestRun) this.merge(result.data.latestRun);
        if (result.data.nextScheduledRun) this.merge(result.data.nextScheduledRun);
      } catch (error) {
        this.overviewError = asError(error);
      } finally {
        this.overviewLoading = false;
        this.notify();
      }
    }
  }

  private async loadHistoryPage(
    filter: RunHistoryFilter,
    limit: number,
    reset: boolean
  ): Promise<void> {
    const state = this.ensureHistory(filter);
    state.loading = true;
    state.error = null;
    this.notify();
    try {
      const before = reset
        ? undefined
        : state.ids
            .map((id) => this.runs.get(id)?.seq)
            .filter((seq): seq is number => seq !== undefined)
            .at(-1);
      const client = await getDesktopWireClient();
      const result = await client.automations.listRuns({
        projectId: this.projectId,
        automationId: this.automationId,
        status: filter === 'all' ? undefined : filter,
        before,
        limit,
      });
      if (!result.success) throw new Error(result.error.message);
      for (const run of result.data.runs) this.merge(run);
      const ids = result.data.runs.map((run) => run.id);
      state.ids = reset ? ids : [...state.ids, ...ids.filter((id) => !state.ids.includes(id))];
      state.hasMore = result.data.runs.length === limit;
      state.loaded = true;
    } catch (error) {
      state.error = asError(error);
    } finally {
      state.loading = false;
      this.notify();
    }
  }

  private merge(run: AutomationRun, updateCounts = false): boolean {
    const existing = this.runs.get(run.id);
    if (existing && existing.seq >= run.seq) return false;
    if (updateCounts) {
      const counts = { ...this.overview.counts };
      if (existing && existing.status !== run.status) {
        counts[existing.status] = Math.max(0, counts[existing.status] - 1);
      }
      if (!existing || existing.status !== run.status) counts[run.status] += 1;
      this.overview = { ...this.overview, counts };
    }
    this.runs.set(run.id, run);
    this.cursor = Math.max(this.cursor, run.seq);
    if (!this.overview.latestRun || run.seq > this.overview.latestRun.seq) {
      if (run.status !== 'scheduled') this.overview.latestRun = run;
    }
    if (run.status === 'scheduled') {
      this.overview.nextScheduledRun = run;
    } else if (this.overview.nextScheduledRun?.id === run.id) {
      this.overview.nextScheduledRun = null;
    }
    this.notify();
    return true;
  }

  private applyRunToLoadedHistories(run: AutomationRun): void {
    for (const [filter, state] of this.histories) {
      if (!state.loaded) continue;
      state.ids = state.ids.filter((id) => id !== run.id);
      if (run.status === 'scheduled') continue;
      if (filter === 'all' || filter === run.status) state.ids.unshift(run.id);
    }
    this.notify();
  }

  private ensureHistory(filter: RunHistoryFilter): HistoryState {
    let state = this.histories.get(filter);
    if (!state) {
      state = { ids: [], hasMore: false, loading: false, loaded: false, error: null };
      this.histories.set(filter, state);
    }
    return state;
  }

  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

const stores = new Map<string, AutomationRunStore>();

export function getAutomationRunStore(projectId: string, automationId: string): AutomationRunStore {
  const key = `${projectId}:${automationId}`;
  let store = stores.get(key);
  if (!store) {
    store = new AutomationRunStore(projectId, automationId);
    stores.set(key, store);
  }
  return store;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
