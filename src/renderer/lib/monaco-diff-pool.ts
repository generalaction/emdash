import { loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { DIFF_EDITOR_BASE_OPTIONS } from '@renderer/_deprecated/diff-viewer/editorConfig';
import { getDiffThemeName, registerDiffThemes } from './monacoDiffThemes';

export type PoolEntry = {
  editor: monaco.editor.IStandaloneDiffEditor;
  container: HTMLDivElement;
  status: 'idle' | 'leased';
  /** Per-lease event disposables (height listeners etc.) — cleared on release. */
  disposables: monaco.IDisposable[];
};

const POOL_ROOT_ID = 'monaco-diff-pool-root';
const DEFAULT_RESERVE = 3;

function getPoolRoot(): HTMLDivElement {
  let root = document.getElementById(POOL_ROOT_ID) as HTMLDivElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = POOL_ROOT_ID;
    // Off-screen but in the DOM so Monaco can measure and lay out correctly.
    // display:none would break ResizeObserver; visibility:hidden with real dimensions works.
    root.style.cssText =
      'position:fixed;top:-10000px;left:-10000px;width:800px;height:600px;pointer-events:none;overflow:hidden;';
    document.body.appendChild(root);
  }
  return root;
}

class MonacoDiffPool {
  private pool: PoolEntry[] = [];
  private monacoInstance: typeof monaco | null = null;
  private reserveTarget: number = DEFAULT_RESERVE;
  private initPromise: Promise<void> | null = null;

  /**
   * Eagerly initialise the pool: loads Monaco, registers themes, and pre-creates
   * `reserveTarget` idle editor instances. Safe to call multiple times — subsequent
   * calls return the same promise.
   */
  init(reserveTarget = DEFAULT_RESERVE): Promise<void> {
    this.reserveTarget = reserveTarget;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const m = await loader.init();
      await registerDiffThemes();
      this.monacoInstance = m;
      for (let i = 0; i < this.reserveTarget; i++) {
        this.createEntry(m);
      }
    })();

    return this.initPromise;
  }

  /**
   * Lease an idle editor instance. If none are available, creates one immediately.
   * Schedules background replenishment after returning.
   */
  async lease(): Promise<PoolEntry> {
    // Ensure Monaco is loaded before we try to create any editor.
    if (!this.monacoInstance) {
      await this.init();
    }

    const idle = this.pool.find((e) => e.status === 'idle');
    if (idle) {
      idle.status = 'leased';
      void this.replenish();
      return idle;
    }

    // No idle instance — create one on-demand.
    const entry = this.createEntry(this.monacoInstance!);
    entry.status = 'leased';
    void this.replenish();
    return entry;
  }

  /**
   * Return a leased entry to the pool.
   * Clears per-lease disposables, detaches and disposes models, reparents the
   * container back to the off-screen pool root.
   */
  release(entry: PoolEntry): void {
    // Dispose per-lease event listeners first.
    for (const d of entry.disposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    entry.disposables = [];

    // Detach models before disposal to avoid "disposing of store" errors.
    try {
      const model = entry.editor.getModel();
      entry.editor.setModel(null);
      model?.original.dispose();
      model?.modified.dispose();
    } catch (err) {
      console.warn('[monaco-pool] Model disposal error (suppressed):', err);
    }

    // Move the container back to the off-screen pool root.
    try {
      getPoolRoot().appendChild(entry.container);
    } catch (err) {
      console.warn('[monaco-pool] Container reparent error (suppressed):', err);
    }

    entry.status = 'idle';
  }

  /**
   * Create fresh text models and attach them to the leased editor.
   * Must be called after `lease()` and before the editor is used.
   */
  applyContent(entry: PoolEntry, original: string, modified: string, language: string): void {
    const m = this.monacoInstance;
    if (!m) return;

    // Detach any previous models first.
    const prev = entry.editor.getModel();
    if (prev) {
      entry.editor.setModel(null);
      prev.original.dispose();
      prev.modified.dispose();
    }

    const originalModel = m.editor.createModel(original, language);
    const modifiedModel = m.editor.createModel(modified, language);
    entry.editor.setModel({ original: originalModel, modified: modifiedModel });
  }

  /**
   * Update Monaco's global theme (affects all editor instances simultaneously).
   */
  setTheme(effectiveTheme: string): void {
    this.monacoInstance?.editor.setTheme(getDiffThemeName(effectiveTheme));
  }

  private createEntry(m: typeof monaco): PoolEntry {
    const root = getPoolRoot();

    const container = document.createElement('div');
    container.style.cssText = 'width:100%;height:100%;';
    root.appendChild(container);

    const editor = m.editor.createDiffEditor(container, {
      ...DIFF_EDITOR_BASE_OPTIONS,
      // Default to split; will be overridden by updateOptions() on lease.
      renderSideBySide: true,
    });

    const entry: PoolEntry = {
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
}

export const diffEditorPool = new MonacoDiffPool();
