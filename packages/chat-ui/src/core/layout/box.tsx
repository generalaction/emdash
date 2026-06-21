/**
 * box — small combinator algebra for collocating measurement and rendering.
 *
 * Each `Box` encapsulates three concerns that must stay in sync:
 *   `measure(ctx)`  — exact height in px (matches rendered offsetHeight exactly)
 *   `estimate(ctx)` — cheap O(1) height approximation for off-screen units
 *   `View`          — Solid component that renders at exactly measure() px
 *
 * Leaf constructors: `text`, `fixedLine`, `codeLines`
 * Wrappers:          `chrome`, `clamp`
 * Combinators:       `boxStack`, `pipe`
 * Helpers:           `withWidth`, `withWidthCtx`
 *
 * Width threading
 * ───────────────
 * `chrome` shrinks inner width by `2*(padX+border)`. Its `measure` calls
 * `child.measure(withWidth(ctx, innerW))` and its `View` passes a derived
 * RenderCtx whose `measureCtx()` returns the reduced width. This is proved
 * correct by the box contract tests in box.contract.test.tsx.
 *
 * Closure-based Views
 * ───────────────────
 * Box `View` components are closure-based — each box carries its own `View`
 * function rather than a slot name. This deliberately avoids the "slot
 * indirection" that was removed in the earlier engine simplification
 * (see core/compose.ts header).
 */

import { For, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { BlockStackView } from '../../components/primitives/BlockStackView';
import { PreviewWindow } from '../../components/primitives/PreviewWindow';
import type { StackLayout } from '../compose';
import type { MeasureCtx, Measured, RenderCtx } from '../define';
import type { Block } from '../markdown/document';
import { layoutBlockStack, type BlockStackOpts } from './block-stack';

// ── Box ──────────────────────────────────────────────────────────────────────

/**
 * A collocated measurement + render unit.
 *
 * The `View` component renders at exactly `measure(ctx)` px for the same ctx.
 * Box instances are typically created once per def or once per unit in the
 * `measure`/`Render` implementations of each `UnitDef`.
 */
export type Box = {
  measure(ctx: MeasureCtx): number;
  estimate(ctx: MeasureCtx): number;
  View: Component<{ ctx: RenderCtx }>;
};

// ── Context helpers ───────────────────────────────────────────────────────────

/**
 * Return a new MeasureCtx with `width` overridden.
 * Used by chrome and other wrappers to thread narrowed width to children.
 */
export function withWidth(ctx: MeasureCtx, w: number): MeasureCtx {
  return { ...ctx, width: Math.max(0, w) };
}

/**
 * Return a new RenderCtx whose `measureCtx()` returns a MeasureCtx with
 * the given width. Used by chrome's View to pass the inset width down.
 */
export function withWidthCtx(ctx: RenderCtx, w: number): RenderCtx {
  return {
    ...ctx,
    measureCtx: ctx.measureCtx ? () => withWidth(ctx.measureCtx!(), w) : undefined,
  };
}

// ── Leaf primitives ───────────────────────────────────────────────────────────

/**
 * A fixed-height box that always measures as `h` px.
 *
 * `ViewComp` is the component that fills the `h`-px area. When omitted the
 * box renders an empty div so the height is visible in the DOM for testing.
 */
export function fixedLine(h: number, ViewComp?: Component<{ ctx: RenderCtx }>): Box {
  const FallbackView: Component<{ ctx: RenderCtx }> = () => <div style={{ height: `${h}px` }} />;
  const View = ViewComp ?? FallbackView;
  return {
    measure: () => h,
    estimate: () => h,
    View,
  };
}

/**
 * A box whose height is `n` code lines at `ctx.theme.fonts.code.lineHeight` px each.
 *
 * `ViewComp` is the component that renders the `n` code lines. When omitted
 * the box renders an empty placeholder.
 */
export function codeLines(n: number, ViewComp?: Component<{ ctx: RenderCtx }>): Box {
  const lineH = (ctx: MeasureCtx) => ctx.theme.fonts.code.lineHeight;
  const FallbackView: Component<{ ctx: RenderCtx }> = (props) => {
    const h = () => {
      const mc = props.ctx.measureCtx?.();
      return mc ? n * lineH(mc) : 0;
    };
    return <div style={{ height: `${h()}px` }} />;
  };
  const View = ViewComp ?? FallbackView;
  return {
    measure: (ctx) => n * lineH(ctx),
    estimate: (ctx) => n * lineH(ctx),
    View,
  };
}

/**
 * A prose text content box.
 *
 * `blocks` is the pre-parsed block array (typically from `caches.parseBlocks`).
 * `opts` mirrors `BlockStackOpts` (padY, blockGap, proseGap).
 *
 * `measure` calls `layoutBlockStack` and returns the stack height.
 * `View`    calls `layoutBlockStack` inside a SolidJS memo (reusing the
 *           `measureBlockCached` WeakMap cache, so the second call is free)
 *           and renders through `BlockStackView`.
 */
export function text(blocks: Block[], opts?: BlockStackOpts): Box {
  return {
    measure(ctx) {
      return layoutBlockStack(blocks, ctx, opts).height;
    },
    estimate(ctx) {
      const totalChars = blocks.reduce(
        (sum, b) => sum + ('text' in b && b.text ? (b.text as string).length : 40),
        0
      );
      const lines = Math.max(1, Math.ceil(totalChars / 60));
      return lines * ctx.theme.fonts.body.lineHeight;
    },
    View(props) {
      const node = (): Measured<StackLayout> | null => {
        const mc = props.ctx.measureCtx?.();
        if (!mc) return null;
        return layoutBlockStack(blocks, mc, opts);
      };
      return <Show when={node()}>{(s) => <BlockStackView node={s()} />}</Show>;
    },
  };
}

// ── Chrome wrapper ────────────────────────────────────────────────────────────

export type ChromeOpts = {
  /** Horizontal padding (px) added on each side inside the chrome border. */
  padX?: number;
  /** Vertical padding (px) added at top and bottom inside the chrome border. */
  padY?: number;
  /** Border width (px) on each side. Subtracted from effective child width. */
  border?: number;
  /** Optional header component rendered above the child. */
  Header?: Component<{ ctx: RenderCtx }>;
  /** Fixed height of the header (px). Must match Header's rendered height. */
  headerH?: number;
  /** Optional footer component rendered below the child. */
  Footer?: Component<{ ctx: RenderCtx }>;
  /** Fixed height of the footer (px). Must match Footer's rendered height. */
  footerH?: number;
};

/**
 * Adds a chrome frame around `child`: optional header, vertical padding, and
 * horizontal border/padding that insets the child's available width.
 *
 * Width threading: child receives `ctx.width - 2*(padX+border)`.
 * Height formula:  headerH + padY + child.measure(innerCtx) + padY + footerH
 */
export function chrome(opts: ChromeOpts, child: Box): Box {
  const { padX = 0, padY = 0, border = 0, Header, headerH = 0, Footer, footerH = 0 } = opts;
  const chromeX = 2 * (padX + border);

  return {
    measure(ctx) {
      const innerCtx = withWidth(ctx, ctx.width - chromeX);
      return 2 * border + headerH + padY + child.measure(innerCtx) + padY + footerH;
    },
    estimate(ctx) {
      const innerCtx = withWidth(ctx, ctx.width - chromeX);
      return 2 * border + headerH + padY + child.estimate(innerCtx) + padY + footerH;
    },
    View(props) {
      const innerCtx = (): RenderCtx => {
        const mc = props.ctx.measureCtx?.();
        if (!mc) return props.ctx;
        return withWidthCtx(props.ctx, mc.width - chromeX);
      };
      const style = () => ({
        'padding-top': padY > 0 ? `${padY}px` : undefined,
        'padding-bottom': padY > 0 ? `${padY}px` : undefined,
        'padding-left': padX > 0 ? `${padX}px` : undefined,
        'padding-right': padX > 0 ? `${padX}px` : undefined,
        'border-width': border > 0 ? `${border}px` : undefined,
        'border-style': border > 0 ? ('solid' as const) : undefined,
      });
      return (
        <div style={style()}>
          <Show when={Header}>{(H) => <Dynamic component={H()} ctx={props.ctx} />}</Show>
          <Dynamic component={child.View} ctx={innerCtx()} />
          <Show when={Footer}>{(F) => <Dynamic component={F()} ctx={props.ctx} />}</Show>
        </div>
      );
    },
  };
}

// ── Clamp wrapper ─────────────────────────────────────────────────────────────

export type ClampOpts = {
  /**
   * Reactive accessor: when true, the content is shown full-height (up to
   * the absolute cap). Corresponds to the "inverted collapse" semantics used
   * by thinking / file-op / plan defs.
   */
  expanded?: () => boolean;
  /** Fade overlay direction applied by PreviewWindow. */
  overlay?: 'fade-top' | 'fade-bottom';
  /** When true, PreviewWindow auto-scrolls to bottom on content growth. */
  autoScroll?: boolean;
  /** Reactive accessor for content size (used with autoScroll). */
  contentHeight?: () => number;
};

/**
 * Clamps `child` to at most `maxH` px when collapsed, or to full child height
 * when `opts.expanded()` is true.
 *
 * `measure` returns `min(maxH, child.measure(ctx))` when collapsed, or
 * `child.measure(ctx)` (capped at a larger absolute limit) when expanded.
 *
 * `View` renders a `PreviewWindow` that clips or scrolls the child content.
 */
export function clamp(maxH: number, opts: ClampOpts, child: Box): Box {
  const expanded = opts.expanded ?? (() => false);
  return {
    measure(ctx) {
      const fullH = child.measure(ctx);
      return expanded() ? fullH : Math.min(maxH, fullH);
    },
    estimate(ctx) {
      const fullH = child.estimate(ctx);
      return expanded() ? fullH : Math.min(maxH, fullH);
    },
    View(props) {
      const mc = () => props.ctx.measureCtx?.();
      const clampedH = (): number => {
        const ctx = mc();
        if (!ctx) return maxH;
        const fullH = child.measure(ctx);
        return expanded() ? fullH : Math.min(maxH, fullH);
      };
      return (
        <PreviewWindow
          height={clampedH()}
          maxH={expanded() ? Number.MAX_SAFE_INTEGER : maxH}
          overlay={opts.overlay}
          autoScrollBottom={opts.autoScroll}
          contentHeight={opts.contentHeight}
        >
          <Dynamic component={child.View} ctx={props.ctx} />
        </PreviewWindow>
      );
    },
  };
}

// ── Stack combinator ──────────────────────────────────────────────────────────

/**
 * Vertically stack multiple boxes with optional gaps and padding.
 * All boxes share the same ctx width (no horizontal chrome).
 */
export function boxStack(children: Box[], opts: { gap?: number; padY?: number } = {}): Box {
  const { gap = 0, padY = 0 } = opts;
  return {
    measure(ctx) {
      if (children.length === 0) return 2 * padY;
      let h = 2 * padY;
      for (let i = 0; i < children.length; i++) {
        if (i > 0) h += gap;
        h += children[i].measure(ctx);
      }
      return h;
    },
    estimate(ctx) {
      if (children.length === 0) return 2 * padY;
      let h = 2 * padY;
      for (let i = 0; i < children.length; i++) {
        if (i > 0) h += gap;
        h += children[i].estimate(ctx);
      }
      return h;
    },
    View(props) {
      const indexed = children.map((child, i) => ({ child, i }));
      return (
        <div style={{ 'padding-top': `${padY}px`, 'padding-bottom': `${padY}px` }}>
          <For each={indexed}>
            {({ child, i }) => (
              <div style={{ 'margin-top': i > 0 ? `${gap}px` : undefined }}>
                <Dynamic component={child.View} ctx={props.ctx} />
              </div>
            )}
          </For>
        </div>
      );
    },
  };
}

// ── Pipe ──────────────────────────────────────────────────────────────────────

/**
 * Compose wrappers left-to-right onto a child box.
 *
 * `pipe(child, w1, w2)` is equivalent to `w2(w1(child))` — w1 is applied
 * first (closest to the child), w2 last (outermost). This matches the visual
 * reading order: "the child, wrapped by w1, then w2".
 */
export function pipe(child: Box, ...wrappers: Array<(b: Box) => Box>): Box {
  return wrappers.reduce((b, w) => w(b), child);
}
