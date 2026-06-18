/**
 * Row — generic row dispatcher driven by REGISTRY.
 *
 * Owns the virtualizer height bridge: computes exact layout via the registry
 * def's `measure()`, writes the height into the Fenwick tree via `virt.setSize`,
 * and delegates rendering to the def's `Render` component via <Dynamic>.
 *
 * Per-row state:
 *   measured  — DOM-measured heights for islands and thinking bodies, written
 *               back by the Render component through ctx.setMeasured.
 *
 * Rendered via <For> keyed by row index, so each Row instance owns a fixed row
 * index for its lifetime — no slot recycling, no cross-row state contamination.
 *
 * Debug overlay: when DebugContext is enabled, a dashed boundary is drawn over
 * the full row at the virtualizer-reserved height. A red boundary + label means
 * the rendered height differs from what the engine reserved.
 */

import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ChatCaches } from '../core/caches';
import type { Measured, MeasureCtx, RenderCtx } from '../core/define';
import type { ChatTheme } from '../core/theme';
import type { Virtualizer } from '../core/virtualizer';
import type { ChatItem } from '../model';
import type { ViewState } from '../state/view-state';
import { useDebug } from './debug-context';
import { REGISTRY } from './registry';

// ── Two-level identity-based memo ─────────────────────────────────────────────
//
// Level 1 (nodeMemo, here): WeakMap keyed by the ChatItem object.
//   Skips the entire def.measure() call for committed (non-streaming) items
//   when the fingerprint is unchanged.
//   activeTurn rows bypass this level (streaming — content changes every tick),
//   but they benefit from Level 2.
//
// Level 2 (blockMemo, core/layout/block-stack.ts): WeakMap keyed by Block object.
//   Skips individual block re-measures for unchanged blocks within a streaming
//   row. Since parseMarkdownToBlocksCached reuses the same Block object for
//   unchanged content, only the last growing block is a miss each tick.
//
// Fingerprint: theme.version + rowWidth + isCollapsed(item.id) + expanded(item.id)
//              (covers all Lane A inputs — see core/define.ts state split docs)

// oxlint-disable typescript/no-explicit-any -- cache boundary; each kind is type-safe at its own def
const nodeMemo = new WeakMap<object, { fingerprint: string; result: Measured<any> }>();

function cachedMeasure(item: ChatItem, isActiveTurn: boolean, ctx: MeasureCtx): Measured<any> {
  const def = REGISTRY[item.kind as keyof typeof REGISTRY];

  // Always recompute for activeTurn rows (streaming, content changes every tick).
  if (isActiveTurn) return def.measure(item, ctx);

  // Include expanded(id) in the fingerprint only for collapsible defs.
  // Non-collapsible defs never call ctx.expanded so it has no effect on layout.
  const expandedBit = def.collapse !== undefined ? ctx.expanded(item.id) : '';
  const fingerprint = `${ctx.theme.version}|${ctx.width}|${ctx.isCollapsed(item.id)}|${expandedBit}`;
  const cached = nodeMemo.get(item);
  if (cached?.fingerprint === fingerprint) return cached.result;

  const result = def.measure(item, ctx);
  nodeMemo.set(item, { fingerprint, result });
  return result;
}
// oxlint-enable typescript/no-explicit-any

export type RowProps = {
  item: ChatItem;
  index: number;
  rowWidth: number;
  theme: ChatTheme;
  viewState: ViewState;
  virt: Virtualizer;
  onHeightChanged: (index: number, delta: number) => void;
  /** True when this row is in the activeTurn (currently streaming). */
  isActiveTurn?: boolean;
  /** Per-instance cache bundle from ChatRoot. */
  caches: ChatCaches;
};

// ── Row-level debug overlay ────────────────────────────────────────────────────

function RowDebugOverlay(props: { reserved: number; rowEl: () => HTMLElement | undefined }) {
  const [mismatch, setMismatch] = createSignal(false);
  const [actualH, setActualH] = createSignal(0);

  onMount(() => {
    const el = props.rowEl();
    if (!el) return;

    const check = () => {
      const h = el.offsetHeight;
      setActualH(h);
      setMismatch(Math.abs(h - props.reserved) > 0.5);
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    onCleanup(() => ro.disconnect());
    requestAnimationFrame(check);
  });

  return (
    <div
      class="pointer-events-none absolute inset-x-0 top-0 outline outline-1 outline-dashed"
      style={{ height: `${props.reserved}px` }}
      classList={{
        'outline-red-500/80': mismatch(),
        'outline-emerald-400/50': !mismatch(),
      }}
    >
      <span class="absolute top-0 left-0 bg-black/70 px-1 text-[9px] leading-tight text-white">
        row · reserved={props.reserved}
        <Show when={mismatch()}>
          {' '}
          <span class="text-red-400">
            ⚠ actual={actualH()} (+{actualH() - props.reserved})
          </span>
        </Show>
      </span>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

export function Row(props: RowProps) {
  const debug = useDebug();

  let rowEl: HTMLElement | undefined;

  // ── Contexts ─────────────────────────────────────────────────────────────────

  const resolveExpanded = (id: string): boolean => {
    const collapseDecl = def().collapse;
    if (!collapseDecl) return false;
    const flag = props.viewState.isCollapsed(id);
    if (collapseDecl.mode === 'inverted') {
      // Inverted: stored "collapsed" flag means "expanded"; absence means not expanded.
      return flag;
    }
    // Normal: expanded when the view-state "collapsed" flag is NOT set.
    return !flag;
  };

  const measureCtx = (): MeasureCtx => ({
    theme: props.theme,
    width: props.rowWidth,
    isCollapsed: (id) => props.viewState.isCollapsed(id),
    expanded: resolveExpanded,
    caches: props.caches,
  });

  const renderCtx: RenderCtx = {
    viewState: { isCollapsed: (id) => props.viewState.isCollapsed(id) },
  };

  // ── Def + layout ────────────────────────────────────────────────────────────

  const def = createMemo(() => REGISTRY[props.item.kind as keyof typeof REGISTRY]);

  // Per-kind symmetric wrapper padding declared in each ComponentDef.
  const padY = () => def().padY ?? 0;

  // ── Layout + height bridge ────────────────────────────────────────────────────

  const layout = createMemo(() => cachedMeasure(props.item, !!props.isActiveTurn, measureCtx()));

  // Virtualizer height = content height + both padding sides.
  const reserved = () => layout().height + 2 * padY();

  createEffect(() => {
    const delta = props.virt.setSize(props.index, reserved());
    if (delta !== 0) props.onHeightChanged(props.index, delta);
  });

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={(e) => {
        rowEl = e;
      }}
      style={{
        position: 'relative',
        'padding-top': `${padY()}px`,
        'padding-bottom': `${padY()}px`,
      }}
    >
      <Dynamic component={def().Render} item={props.item} layout={layout()} ctx={renderCtx} />
      <Show when={debug()}>
        <RowDebugOverlay reserved={reserved()} rowEl={() => rowEl} />
      </Show>
    </div>
  );
}
