import { join } from 'node:path';
import { app, utilityProcess, type UtilityProcess } from 'electron';
import { log } from '@main/lib/logger';
import { EMPTY_USAGE_SNAPSHOT, type UsageSnapshot } from '@shared/usage';
import { ensureModelsDevPricing } from './models-dev';
import { runPipeline } from './pipeline';
import { getRemoteRates, type ModelRate } from './pricing';
import { isSnapshotStale } from './staleness';
import type { WorkerResponse } from './usage-worker';

// Generous: protects against a wedged worker. On timeout we fall back to the inline pass.
const WORKER_TIMEOUT_MS = 120_000;

// Serve-stale-while-revalidate window. Old snapshots are served instantly; a background
// refresh runs so the renderer's next poll picks up fresh numbers. Cheap: the mtime+size
// cache means only changed transcript files re-parse.
const SNAPSHOT_TTL_MS = 5 * 60_000;

class UsageStatsService {
  private snapshot: UsageSnapshot = EMPTY_USAGE_SNAPSHOT;
  private indexPath = '';
  private computing: Promise<UsageSnapshot> | null = null;
  private worker: UtilityProcess | null = null;

  /**
   * Lazily computes on first access, then serves the cached snapshot. We do NOT warm on app
   * start: a cold cache scans/parses every local transcript (potentially GBs of JSONL). That
   * work runs in a utilityProcess worker (off the main thread), with an inline fallback if the
   * worker can't run, so the first Usage-tab open pays the cost without freezing the UI.
   */
  async getSnapshot(): Promise<UsageSnapshot> {
    if (this.snapshot.generatedAt === '') return this.refresh();
    if (isSnapshotStale(this.snapshot.generatedAt, Date.now(), SNAPSHOT_TTL_MS)) {
      this.refresh().catch((error) =>
        log.warn('usage-stats: background refresh failed', { error })
      );
    }
    return this.snapshot;
  }

  refresh(): Promise<UsageSnapshot> {
    if (this.computing) return this.computing;
    this.computing = this.compute().finally(() => {
      this.computing = null;
    });
    return this.computing;
  }

  private async compute(): Promise<UsageSnapshot> {
    await ensureModelsDevPricing(); // installs rates in the main pricing module (electron + network)
    const indexPath = this.getIndexPath();
    const now = new Date();
    try {
      this.snapshot = await this.computeInWorker(indexPath, now);
    } catch (error) {
      // Worker couldn't run (spawn/asar/timeout) — fall back to the inline pass. Same result,
      // just blocking; the rates are already installed in this process from ensureModelsDevPricing.
      log.warn('usage-stats: worker compute failed, running inline', { error });
      this.snapshot = runPipeline(indexPath, now);
    }
    return this.snapshot;
  }

  private computeInWorker(indexPath: string, now: Date): Promise<UsageSnapshot> {
    const worker = this.ensureWorker();
    const rates: Array<[string, ModelRate]> = [...getRemoteRates().entries()];

    return new Promise<UsageSnapshot>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('exit', onExit);
      };
      const onMessage = (res: WorkerResponse): void => {
        cleanup();
        if (res.ok) resolve(res.snapshot);
        else reject(new Error(res.error));
      };
      const onExit = (code: number): void => {
        cleanup();
        reject(new Error(`usage worker exited (${code}) before responding`));
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('usage worker timed out'));
      }, WORKER_TIMEOUT_MS);

      worker.on('message', onMessage);
      worker.on('exit', onExit);
      worker.postMessage({ indexPath, rates, nowISO: now.toISOString() });
    });
  }

  /** Fork the worker lazily and reuse it across refreshes; respawn after an exit. */
  private ensureWorker(): UtilityProcess {
    if (this.worker) return this.worker;
    // __dirname resolves to out/main/ at runtime; the worker is emitted alongside index.js.
    const w = utilityProcess.fork(join(__dirname, 'usage-worker.js'), [], {
      serviceName: 'emdash-usage-stats',
    });
    w.on('exit', () => {
      if (this.worker === w) this.worker = null;
    });
    this.worker = w;
    return w;
  }

  private getIndexPath(): string {
    if (!this.indexPath) this.indexPath = join(app.getPath('userData'), 'usage-index.json');
    return this.indexPath;
  }
}

export const usageStatsService = new UsageStatsService();
