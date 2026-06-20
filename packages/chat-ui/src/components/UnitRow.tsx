/**
 * UnitRow — unit-level row renderer driven by UNIT_REGISTRY.
 *
 * The virtualizer indexes a flat RenderUnit[] array produced by flatten().
 * Each visible unit index renders via this component.
 *
 * Rendering:
 *   UnitDef.measure(data, ctx) → number  (content height)
 *   UnitDef.Render({ data, ctx })
 *   GroupChrome from the segmenter is applied per groupRole.
 *
 * Height reservation:
 *   unitReservedHeight(unit, contentH)
 *   = gapBefore + contentH + chrome padY overhead + ROW_GAP (last/solo only)
 *
 * Note on gapBefore: flatten() sets gapBefore = ROW_GAP on the first unit of
 * every group except the first group in the transcript. This replaces the
 * bottom-padding approach in the old Row.tsx and achieves the same spacing.
 *
 * Debug overlay: dashed outline at reserved height; red when actual ≠ reserved.
 */

import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { ChatCaches } from '../core/caches';
import type { MeasureCtx, RenderCtx } from '../core/define';
import { ROW_GAP } from '../core/metrics';
import type { ChatTheme } from '../core/theme';
import type { GroupChrome, RenderUnit } from '../core/units';
import { unitReservedHeight } from '../core/units';
import type { Virtualizer } from '../core/virtualizer';
import type { ViewState } from '../state/view-state';
import { useDebug } from './debug-context';
import { UNIT_REGISTRY } from './unit-registry';

// ── GroupChrome helpers ───────────────────────────────────────────────────────

/**
 * Resolve the Tailwind classes for the group chrome wrapper div.
 *
 * Background applies to all units. Border + rounded corners are split by
 * groupRole so a multi-block group looks like one continuous rounded card:
 *   solo   — full border + full rounding
 *   first  — top+sides border, top rounding
 *   middle — sides border only
 *   last   — bottom+sides border, bottom rounding
 */
function chromeClass(chrome: GroupChrome, role: RenderUnit['groupRole']): string {
  const parts: string[] = [];
  if (chrome.background) parts.push(chrome.background);
  if (chrome.borderColor) {
    const color = chrome.borderColor;
    switch (role) {
      case 'solo':
        parts.push(`border ${color} rounded-lg`);
        break;
      case 'first':
        parts.push(`border-t border-l border-r ${color} rounded-t-lg`);
        break;
      case 'middle':
        parts.push(`border-l border-r ${color}`);
        break;
      case 'last':
        parts.push(`border-b border-l border-r ${color} rounded-b-lg`);
        break;
    }
  }
  return parts.join(' ');
}

/**
 * Returns top padding for a unit with chrome:
 *   - gapBefore (inter-group spacing)
 *   - chrome.padY for first/solo units (top padding inside the bubble)
 */
function chromePadTop(chrome: GroupChrome, unit: RenderUnit): number {
  const padY = chrome.padY ?? 0;
  const isFirst = unit.groupRole === 'first' || unit.groupRole === 'solo';
  return unit.gapBefore + (isFirst ? padY : 0);
}

/**
 * Returns bottom padding for a unit with chrome:
 *   - ROW_GAP only for last/solo units (trailing slot space after the group)
 *   - chrome.padY for last/solo units (bottom padding inside the group)
 *   - 0 for first/middle units (next sibling unit's gapBefore provides spacing)
 */
function chromePadBottom(chrome: GroupChrome, unit: RenderUnit): number {
  const padY = chrome.padY ?? 0;
  const isLast = unit.groupRole === 'last' || unit.groupRole === 'solo';
  if (!isLast) return 0;
  return ROW_GAP + padY;
}

// ── Debug overlay ─────────────────────────────────────────────────────────────

function UnitDebugOverlay(props: { reserved: number; rowEl: () => HTMLElement | undefined }) {
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
        unit · reserved={props.reserved}
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

// ── UnitRowProps ──────────────────────────────────────────────────────────────

export type UnitRowProps = {
  unit: RenderUnit;
  /** Absolute unit index in the flat units array (used by virt.setSize). */
  index: number;
  rowWidth: number;
  theme: ChatTheme;
  viewState: ViewState;
  virt: Virtualizer;
  onHeightChanged: (index: number, delta: number) => void;
  /** True when the unit's source item is in activeTurn (currently streaming). */
  isActiveTurn?: boolean;
  /** Per-instance cache bundle from ChatRoot. */
  caches: ChatCaches;
  /**
   * Monotonic counter from ChatRoot bumped after fonts load.
   * Threaded into MeasureCtx so blockMemo fingerprints become stale,
   * forcing a re-measure with correct font metrics.
   */
  measureEpoch?: number;
  /**
   * Id of the single currently-expanded user message card (from ChatRoot).
   * Threaded into MeasureCtx so user card measure re-runs when expand toggles.
   */
  expandedId?: string | null;
};

// ── UnitRow ───────────────────────────────────────────────────────────────────

export function UnitRow(props: UnitRowProps) {
  const debug = useDebug();
  let rowEl: HTMLElement | undefined;

  const def = createMemo(() => UNIT_REGISTRY[props.unit.kind]);

  const chrome = createMemo(() => props.unit.chrome);
  const insetX = createMemo(() => chrome()?.insetX ?? 0);

  const measureCtx = (): MeasureCtx => ({
    theme: props.theme,
    width: Math.max(0, props.rowWidth - 2 * insetX()),
    isCollapsed: (id) => props.viewState.isCollapsed(id),
    expanded: (id) => props.viewState.isCollapsed(id),
    caches: props.caches,
    measureEpoch: props.measureEpoch,
    expandedId: props.expandedId,
  });

  const renderCtx: RenderCtx = {
    viewState: { isCollapsed: (id) => props.viewState.isCollapsed(id) },
    measureCtx,
  };

  const contentH = createMemo(() => {
    const d = def();
    if (!d) return 0;
    return d.measure(props.unit.data, measureCtx(), d.vars ?? {});
  });

  const reserved = createMemo(() => unitReservedHeight(props.unit, contentH()));

  createEffect(() => {
    const delta = props.virt.setSize(props.index, reserved());
    if (delta !== 0) props.onHeightChanged(props.index, delta);
  });

  return (
    <div
      ref={(e) => {
        rowEl = e;
      }}
      style={{ position: 'relative' }}
    >
      <Show when={def()}>
        {(d) => {
          const c = chrome();
          return (
            <div
              class={c ? chromeClass(c, props.unit.groupRole) : undefined}
              style={{
                'padding-top': `${c ? chromePadTop(c, props.unit) : props.unit.gapBefore}px`,
                'padding-bottom': c
                  ? `${chromePadBottom(c, props.unit)}px`
                  : props.unit.groupRole === 'last' || props.unit.groupRole === 'solo'
                    ? `${ROW_GAP}px`
                    : '0px',
                'padding-left': `${c ? (c.insetX ?? 0) : 0}px`,
                'padding-right': `${c ? (c.insetX ?? 0) : 0}px`,
              }}
            >
              <Dynamic component={d().Render} data={props.unit.data} ctx={renderCtx} vars={d().vars ?? {}} />
            </div>
          );
        }}
      </Show>
      <Show when={debug()}>
        <UnitDebugOverlay reserved={reserved()} rowEl={() => rowEl} />
      </Show>
    </div>
  );
}
