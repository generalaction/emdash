/**
 * ImperativeChat — the core engine that replaces React + TanStack Virtual.
 *
 * Owns:
 *   - The canvas element (absolute height = virt.total())
 *   - The RowPool (recycles .pchat-row nodes)
 *   - The Virtualizer (Fenwick-tree heights + range math)
 *   - The StickToBottom helper
 *   - MobX autorun/reaction disposers
 *   - Scroll listener, ResizeObserver, font-ready hook, click delegation
 *
 * The React wrapper (projected-transcript.tsx) constructs this engine once on
 * mount and calls dispose() on unmount. No per-frame React reconciliation.
 */

import { autorun, reaction } from 'mobx';
import type { FontConfig } from '../../measure/fonts';
import { registerFontsReadyClear } from '../../measure/pretext-cache';
import { metricsToCssVars } from '../../metrics';
import type { ChatItem, ChatMessage, ChatThinking } from '../../model';
import type { TranscriptStore } from '../../state/transcript-store';
import type { ViewStateStore } from '../../state/view-state-store';
import { renderMessage } from '../dom/render-message';
import { renderThinking } from '../dom/render-thinking';
import { renderTool } from '../dom/render-tool';
import type { LayoutStore } from '../layout/layout-store';
import type { ImperativeSlots } from '../slots';
import { RowPool } from './row-pool';
import { StickToBottom } from './stick-to-bottom';
import { Virtualizer } from './virtualizer';
import style from '../projected.module.css';

const OVERSCAN = 8;

export type ImperativeChatOptions = {
  scrollEl: HTMLElement;
  store: TranscriptStore;
  viewState: ViewStateStore;
  layoutStore: LayoutStore;
  slots?: ImperativeSlots;
  stickToBottom?: boolean;
  fonts?: FontConfig;
};

export class ImperativeChat {
  private readonly scrollEl: HTMLElement;
  private readonly canvasEl: HTMLElement;
  private readonly store: TranscriptStore;
  private readonly viewState: ViewStateStore;
  private readonly layoutStore: LayoutStore;
  private readonly slots: ImperativeSlots | undefined;
  private readonly doStickToBottom: boolean;

  private readonly virt: Virtualizer;
  private readonly pool: RowPool;
  private readonly sticky: StickToBottom;

  private rafPending = false;
  private disposers: Array<() => void> = [];
  /**
   * IDs of thinking items that have already had their collapse seeded.
   * Prevents the per-row reaction from seeding more than once per item.
   */
  private readonly seededCollapsed = new Set<string>();

  constructor(opts: ImperativeChatOptions) {
    this.scrollEl = opts.scrollEl;
    this.store = opts.store;
    this.viewState = opts.viewState;
    this.layoutStore = opts.layoutStore;
    this.slots = opts.slots;
    this.doStickToBottom = opts.stickToBottom ?? true;

    this.virt = new Virtualizer();
    this.pool = new RowPool();
    this.sticky = new StickToBottom(opts.scrollEl);

    // Build and append canvas
    this.canvasEl = document.createElement('div');
    this.canvasEl.className = style['pchat-canvas'];
    this.scrollEl.appendChild(this.canvasEl);

    // Set CSS vars on scroll container (same as metricsToCssVars())
    const cssVars = metricsToCssVars();
    for (const [k, v] of Object.entries(cssVars)) {
      this.scrollEl.style.setProperty(k, v);
    }

    // Initial seed
    this._syncCount();
    this._renderVisible();
    if (this.doStickToBottom) this.sticky.scrollToBottom();

    // ── Scroll listener ─────────────────────────────────────────────────────
    const onScroll = () => this._scheduleFrame();
    this.scrollEl.addEventListener('scroll', onScroll, { passive: true });
    this.disposers.push(() => this.scrollEl.removeEventListener('scroll', onScroll));

    // ── ResizeObserver ───────────────────────────────────────────────────────
    let lastWidth = 0;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? this.scrollEl.clientWidth;
      if (w > 0 && w !== lastWidth) {
        lastWidth = w;
        this.layoutStore.resetForWidth(w);
        // Re-seed virtualizer estimates at new width
        const items = this.store.items;
        for (let i = 0; i < this.virt.count; i++) {
          const item = items[i];
          if (item) {
            this.virt.setSize(i, this.layoutStore.estimateHeight(item));
          }
        }
        this._rerenderAll();
      }
    });
    ro.observe(this.scrollEl);
    this.disposers.push(() => ro.disconnect());

    // ── Fonts ready ──────────────────────────────────────────────────────────
    registerFontsReadyClear(() => {
      this.layoutStore.resetForWidth(0);
      const w = lastWidth;
      if (w > 0) this.layoutStore.resetForWidth(w);
      this._rerenderAll();
    });

    // ── MobX: item count / identity changes ──────────────────────────────────
    const disposeAutorun = autorun(() => {
      const items = this.store.items;

      // Access the items array to subscribe to count + deep identity changes in MobX
      void items.slice();

      this._syncCount();
      this._renderVisible();
      if (this.doStickToBottom) this.sticky.schedule();
    });
    this.disposers.push(disposeAutorun);

    // ── MobX: collapse version changes ───────────────────────────────────────
    const disposeReaction = reaction(
      () => this.viewState.collapseVersion,
      () => {
        // LayoutStore cache keys include collapseVersion, so they self-invalidate.
        // Just re-render all visible rows with fresh layouts.
        this._rerenderVisible();
      }
    );
    this.disposers.push(disposeReaction);

    // ── Click delegation ─────────────────────────────────────────────────────
    const onClick = (e: Event) => {
      const target = (e.target as HTMLElement).closest('[data-collapse-id]') as HTMLElement | null;
      if (target) {
        const blockId = target.dataset.collapseId;
        if (blockId) this.viewState.toggleCollapsed(blockId);
      }
    };
    this.scrollEl.addEventListener('click', onClick);
    this.disposers.push(() => this.scrollEl.removeEventListener('click', onClick));
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Sync virtualizer row count to current store.items.length. */
  private _syncCount(): void {
    const items = this.store.items;
    const n = items.length;
    this.virt.setCount(n, (i) => {
      const item = items[i];
      return item ? this.layoutStore.estimateHeight(item) : 60;
    });
    this.canvasEl.style.height = `${this.virt.total()}px`;
  }

  /** Schedule a rAF-throttled render pass. */
  private _scheduleFrame(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this._renderVisible();
    });
  }

  /** Mount visible rows, unmount out-of-range rows. */
  private _renderVisible(): void {
    const { scrollTop, clientHeight } = this.scrollEl;
    const { start, end } = this.virt.range(scrollTop, clientHeight, OVERSCAN);
    const items = this.store.items;

    // Unmount rows outside the new range
    for (const idx of [...this.pool.mountedIndices()]) {
      if (idx < start || idx > end) {
        this.pool.unmount(idx);
      }
    }

    // Mount rows in range
    for (let i = start; i <= end; i++) {
      if (this.pool.has(i)) {
        // Already mounted — update position in case heights changed
        const row = this.pool.get(i)!;
        this._positionRow(row.node, i);
        continue;
      }

      const item = items[i];
      if (!item) continue;

      this._mountRow(i, item);
    }
  }

  /** Build and mount a single row at index i. */
  private _mountRow(i: number, item: ChatItem): void {
    const container = this.pool.acquire();
    container.dataset.index = String(i);

    let dispose: () => void;
    let contentNode: HTMLElement;

    const onHeightChange = () => {
      // Island / body measured → update height + correct scroll anchor
      const layout = this.layoutStore.getLayout(item, this.viewState);
      const delta = this.virt.setSize(i, layout.height);
      this.canvasEl.style.height = `${this.virt.total()}px`;
      if (delta !== 0) {
        const rowTop = this.virt.top(i);
        if (rowTop < this.scrollEl.scrollTop) {
          this.scrollEl.scrollTop += delta;
        }
      }
      if (this.doStickToBottom) this.sticky.schedule();
    };

    if (item.kind === 'message') {
      const result = renderMessage(
        item as ChatMessage,
        this.layoutStore,
        this.viewState,
        this.slots,
        onHeightChange
      );
      contentNode = result.node;
      dispose = result.dispose;
    } else if (item.kind === 'thinking') {
      const thinking = item as ChatThinking;
      const result = renderThinking(thinking, this.layoutStore, this.viewState, (id, h) => {
        this.layoutStore.setMeasured(id, h);
        onHeightChange();
      });
      contentNode = result.node;

      if (thinking.status === 'thinking' && result.live) {
        const { labelEl, windowTextEl } = result.live;

        // Per-row ticker: patch duration label every second.
        const timer = setInterval(() => {
          const elapsed = Math.floor((Date.now() - thinking.startedAt) / 1000);
          labelEl.textContent = `Thinking ${elapsed}s`;
        }, 1000);

        // Per-row reaction: patch streaming window text; detect done transition.
        const reactionDispose = reaction(
          () => ({ text: thinking.text, status: thinking.status }),
          ({ text, status }) => {
            windowTextEl.textContent = text;
            // Scroll window to show latest text at the bottom.
            const parent = windowTextEl.parentElement;
            if (parent) parent.scrollTop = parent.scrollHeight;

            if (status === 'done' && !this.seededCollapsed.has(thinking.id)) {
              this.seededCollapsed.add(thinking.id);
              clearInterval(timer);
              // Seed collapsed state; this bumps collapseVersion which triggers
              // the global collapse reaction → _rerenderVisible → remounts done row.
              this.viewState.setCollapsed(thinking.id, true);
            }
          },
          { fireImmediately: true }
        );

        dispose = () => {
          clearInterval(timer);
          reactionDispose();
        };
      } else {
        dispose = () => {};
      }
    } else {
      contentNode = renderTool(item);
      dispose = () => {};
    }

    container.appendChild(contentNode);
    this.canvasEl.appendChild(container);

    // Compute exact layout height (from LayoutStore, not DOM measurement)
    const layout = this.layoutStore.getLayout(item, this.viewState);
    const exactH = layout.height;
    const delta = this.virt.setSize(i, exactH);

    this.canvasEl.style.height = `${this.virt.total()}px`;

    // Scroll-anchor correction: if this row is above viewport and height changed,
    // shift scrollTop to prevent content jump
    if (delta !== 0) {
      const rowTop = this.virt.top(i);
      if (rowTop < this.scrollEl.scrollTop) {
        this.scrollEl.scrollTop += delta;
      }
    }

    this._positionRow(container, i);

    this.pool.register(i, { node: container, dispose });
  }

  /** Set transform and containIntrinsicSize on a row element. */
  private _positionRow(node: HTMLElement, i: number): void {
    const top = this.virt.top(i);
    const h = this.virt.size(i);
    node.style.transform = `translateY(${top}px)`;
    node.style.containIntrinsicSize = `0 ${h}px`;
  }

  /** Unmount and remount all currently visible rows (after width/font change). */
  private _rerenderAll(): void {
    for (const idx of [...this.pool.mountedIndices()]) {
      this.pool.unmount(idx);
    }
    this._syncCount();
    this._renderVisible();
  }

  /** Remount visible rows without touching invisible ones (after collapse change). */
  private _rerenderVisible(): void {
    const { scrollTop, clientHeight } = this.scrollEl;
    const { start, end } = this.virt.range(scrollTop, clientHeight, OVERSCAN);
    for (let i = start; i <= end; i++) {
      this.pool.unmount(i);
    }
    this._renderVisible();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Tear down all listeners, observers, and mounted rows. */
  dispose(): void {
    this.pool.disposeAll();
    this.sticky.dispose();
    for (const d of this.disposers) d();
    this.disposers = [];
    if (this.canvasEl.parentNode === this.scrollEl) {
      this.scrollEl.removeChild(this.canvasEl);
    }
  }
}
