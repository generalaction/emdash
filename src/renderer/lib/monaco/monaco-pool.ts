import { loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { log } from '@renderer/utils/logger';

export type PoolEntry<TEditor> = {
  editor: TEditor;
  container: HTMLDivElement;
  status: 'idle' | 'leased';
  /** Per-lease event disposables — cleared on release. */
  disposables: monaco.IDisposable[];
};

export type MonacoPoolOptions<TEditor> = {
  /** Used as the DOM root element ID for this pool's off-screen container. */
  poolId: string;
  /** Number of idle instances to keep pre-warmed. Default: 1. */
  reserveTarget?: number;
  /** Factory: create a new editor instance inside the given container. */
  createEditor: (m: typeof monaco, container: HTMLDivElement) => TEditor;
  /**
   * Called during release before the container is reparented.
   * Use to dispose models, reset options, etc.
   */
  cleanupOnRelease: (editor: TEditor) => void;
  /** Called once after Monaco loads, before pre-warming entries. */
  onInit?: (m: typeof monaco) => Promise<void>;
};

const DEFAULT_RESERVE = 2;

export class MonacoPool<TEditor> {
  private pool: PoolEntry<TEditor>[] = [];
  private monacoInstance: typeof monaco | null = null;
  private reserveTarget: number;
  private initPromise: Promise<void> | null = null;
  private readonly options: MonacoPoolOptions<TEditor>;

  constructor(options: MonacoPoolOptions<TEditor>) {
    this.options = options;
    this.reserveTarget = options.reserveTarget ?? DEFAULT_RESERVE;
  }

  /**
   * Load Monaco, run onInit, and pre-create idle entries.
   * Safe to call multiple times — subsequent calls return the same promise.
   */
  init(reserveTarget?: number): Promise<void> {
    if (reserveTarget !== undefined) {
      this.reserveTarget = reserveTarget;
    }
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const m = await loader.init();
      this.monacoInstance = m;
      // Expose Monaco globally so module-level singletons (e.g. MonacoModelRegistry)
      // can access it without a direct import dependency on the pool.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__monaco = m;
      if (this.options.onInit) {
        await this.options.onInit(m);
      }
      for (let i = 0; i < this.reserveTarget; i++) {
        this.createEntry(m);
      }
    })();

    return this.initPromise;
  }

  /**
   * Lease an idle editor instance. Creates one on-demand if none are available.
   * Schedules background replenishment after returning.
   */
  async lease(): Promise<PoolEntry<TEditor>> {
    if (!this.monacoInstance) {
      await this.init();
    }

    const idle = this.pool.find((e) => e.status === 'idle');
    if (idle) {
      idle.status = 'leased';
      void this.replenish();
      return idle;
    }

    const entry = this.createEntry(this.monacoInstance!);
    entry.status = 'leased';
    void this.replenish();
    return entry;
  }

  /**
   * Return a leased entry to the pool.
   * Disposes per-lease disposables, calls cleanupOnRelease, reparents container.
   */
  release(entry: PoolEntry<TEditor>): void {
    for (const d of entry.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    entry.disposables = [];

    try {
      this.options.cleanupOnRelease(entry.editor);
    } catch (err) {
      log.debug(`[${this.options.poolId}] cleanupOnRelease error (suppressed):`, err);
    }

    try {
      this.getPoolRoot().appendChild(entry.container);
    } catch (err) {
      log.debug(`[${this.options.poolId}] container reparent error (suppressed):`, err);
    }

    entry.status = 'idle';
  }

  /**
   * Set the global Monaco theme (affects all instances simultaneously).
   * Pass the resolved theme name (e.g. 'custom-dark'), not the app theme key.
   */
  setTheme(themeName: string): void {
    this.monacoInstance?.editor.setTheme(themeName);
  }

  /** Returns the underlying Monaco instance, or null if not yet initialised. */
  getMonaco(): typeof monaco | null {
    return this.monacoInstance;
  }

  private createEntry(m: typeof monaco): PoolEntry<TEditor> {
    const root = this.getPoolRoot();
    const container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;';
    root.appendChild(container);

    const editor = this.options.createEditor(m, container);
    const entry: PoolEntry<TEditor> = {
      editor,
      container,
      status: 'idle',
      disposables: [],
    };
    this.pool.push(entry);
    return entry;
  }

  private async replenish(): Promise<void> {
    if (!this.monacoInstance) return;
    const idleCount = this.pool.filter((e) => e.status === 'idle').length;
    const needed = this.reserveTarget - idleCount;
    for (let i = 0; i < needed; i++) {
      this.createEntry(this.monacoInstance);
    }
  }

  private getPoolRoot(): HTMLDivElement {
    const id = this.options.poolId;
    let root = document.getElementById(id) as HTMLDivElement | null;
    if (!root) {
      root = document.createElement('div');
      root.id = id;
      // Off-screen but still in the DOM so Monaco's ResizeObserver works correctly.
      // visibility:hidden with real dimensions avoids display:none breaking layout measurement.
      root.style.cssText =
        'position:fixed;top:-10000px;left:-10000px;width:800px;height:600px;' +
        'pointer-events:none;overflow:hidden;visibility:hidden;';
      document.body.appendChild(root);
    }
    return root;
  }
}
