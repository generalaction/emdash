/**
 * Layout combinators.
 *
 * Pure arithmetic functions that compose `Measured` children into larger
 * `Measured` trees.  No DOM access; no Solid primitives.
 *
 * Each combinator returns a `Measured` whose `layout.kind` discriminates the
 * payload type so the generic `Project` renderer can walk the tree.
 *
 * Combinators:
 *   stack        — vertical sequence with symmetric padY and per-gap function.
 *   pad          — uniform padding + optional border around one child.
 *   bubble       — horizontal hug-wrap (user message bubble).
 *   collapsible  — header slot + optional collapsible body.
 *   scrollWindow — clip a tall child to a fixed-height scroll viewport.
 *   slot         — named placeholder for non-generic chrome (headers/footers).
 *
 * Width convention: width flows *down* (callers narrow the budget before
 * calling measure); height flows *up* (combinators accumulate child heights).
 */

import type { Measured } from './define';

// ── Layout payload types ───────────────────────────────────────────────────────

export type PlacedChild = { id: string; top: number; child: Measured };

export type StackLayout = {
  kind: 'stack';
  placed: PlacedChild[];
};

export type PadLayout<L = unknown> = {
  kind: 'pad';
  padX: number;
  padY: number;
  border: number;
  child: Measured<L>;
};

export type BubbleLayout<L = unknown> = {
  kind: 'bubble';
  padX: number;
  padY: number;
  child: Measured<L>;
  /**
   * Optional Tailwind/CSS class string applied to the bubble container by
   * ProjectBubble (e.g. background color, border-radius, text color).
   */
  variantClass?: string;
  /**
   * Explicit pixel width for the bubble container. When absent, Project
   * renders the bubble at 100% of the available width.
   */
  width?: number;
};

export type CollapsibleLayout<L = unknown> = {
  kind: 'collapsible';
  headerH: number;
  headerTop: number;
  bodyTop: number;
  expanded: boolean;
  child: Measured<L> | null;
  /**
   * Name of the slot rendered as the header.  Project resolves this from the
   * `slots` map passed to `<Project>`.
   */
  headerSlot: string;
};

export type WindowLayout<L = unknown> = {
  kind: 'window';
  maxH: number;
  child: Measured<L>;
  /**
   * Optional decorative fade overlay applied by ProjectWindow.
   * 'fade-top'    — gradient from transparent at top to opaque (for preview scroll).
   * 'fade-bottom' — gradient from opaque to transparent (for truncated diffs).
   */
  overlay?: 'fade-top' | 'fade-bottom';
  /** When true, ProjectWindow auto-scrolls to the bottom whenever child height changes. */
  autoScrollBottom?: boolean;
};

// ── slot ──────────────────────────────────────────────────────────────────────

/**
 * A named placeholder for non-generic chrome (headers, footers, diff-body).
 *
 * `slot` has no generic children — it is a leaf in the compose tree.
 * `Project` dispatches it by `name` using the `slots` map supplied by the
 * calling Render shell.
 *
 * Callers pass the precise pixel height expected from the real chrome so the
 * tree's total height is correct.  If the real height diverges, contract
 * tests will catch it.
 */
export type SlotLayout = {
  kind: 'slot';
  name: string;
  height: number;
};

// ── stack ─────────────────────────────────────────────────────────────────────

/**
 * Vertically stack an ordered list of children with a symmetric top/bottom
 * padding and a per-slot gap function.
 *
 * The `gap` parameter may be:
 *   - a constant number applied between every pair of adjacent children
 *   - a function `(idx) => number` called with the current child index (≥ 1)
 *     so callers can vary the gap based on position (e.g. proseGap vs blockGap)
 *
 * Returns a `StackLayout` whose `placed` entries carry the absolute `top`
 * offset of each child within the stack's content area (padY already included).
 */
export function stack(
  children: { id: string; measured: Measured }[],
  opts: { padY?: number; gap?: number | ((idx: number) => number) } = {}
): Measured<StackLayout> {
  const padY = opts.padY ?? 0;
  let cursor = padY;
  let maxWidth = 0;
  const placed: PlacedChild[] = [];

  for (let i = 0; i < children.length; i++) {
    const { id, measured } = children[i];
    if (i > 0) {
      const gap = typeof opts.gap === 'function' ? opts.gap(i) : (opts.gap ?? 0);
      cursor += gap;
    }
    placed.push({ id, top: cursor, child: measured });
    cursor += measured.height;
    maxWidth = Math.max(maxWidth, measured.width);
  }

  cursor += padY;

  return {
    height: cursor,
    width: maxWidth,
    layout: { kind: 'stack', placed },
  };
}

// ── pad ───────────────────────────────────────────────────────────────────────

/**
 * Wrap a child in uniform padding and an optional border.
 *
 * The child's `height`/`width` are grown by `2*padY + 2*border` and
 * `2*padX + 2*border` respectively. The child's position inside the pad
 * region is at `(padX + border, padY + border)` — the `Project` renderer
 * applies this offset when positioning the inner content.
 */
export function pad<L>(
  child: Measured<L>,
  opts: { padX?: number; padY?: number; border?: number } = {}
): Measured<PadLayout<L>> {
  const padX = opts.padX ?? 0;
  const padY = opts.padY ?? 0;
  const border = opts.border ?? 0;
  const chrome = 2 * border;
  return {
    height: child.height + 2 * padY + chrome,
    width: child.width + 2 * padX + chrome,
    layout: { kind: 'pad', padX, padY, border, child },
  };
}

// ── bubble ────────────────────────────────────────────────────────────────────

/**
 * Horizontal hug for the user-message bubble.
 *
 * Unlike `pad`, `bubble` does NOT increase the height — the vertical padding
 * is already baked into the child's height via a `stack` call.  It only
 * expands the *reported width* by `2*padX` so the caller can derive the
 * rendered bubble width (content width + 2 × side padding).
 *
 * `variantClass` is applied to the bubble div by ProjectBubble (bg, radius, etc.)
 * `width` pins the bubble container to an explicit pixel width (user bubble hug).
 */
export function bubble<L>(
  child: Measured<L>,
  opts: {
    padX?: number;
    padY?: number;
    variantClass?: string;
    width?: number;
  } = {}
): Measured<BubbleLayout<L>> {
  const padX = opts.padX ?? 0;
  const padY = opts.padY ?? 0;
  return {
    height: child.height,
    width: opts.width ?? child.width + 2 * padX,
    layout: {
      kind: 'bubble',
      padX,
      padY,
      child,
      variantClass: opts.variantClass,
      width: opts.width,
    },
  };
}

// ── collapsible ───────────────────────────────────────────────────────────────

/**
 * A header slot (fixed height) plus an optional collapsible body.
 *
 * When `expanded` is false (or `body` is absent), only the header contributes
 * to `height`.  When `expanded` is true and `body` is provided, height =
 * headerH + body.height.
 *
 * `headerTop` is always 0 (the header is the first element).
 * `bodyTop` is always `headerH`.
 *
 * `headerSlot` — the slot name that `Project` resolves from its `slots` map
 * to render the header chrome.
 */
export function collapsible<L>(opts: {
  headerH: number;
  headerSlot: string;
  expanded: boolean;
  body?: Measured<L>;
}): Measured<CollapsibleLayout<L>> {
  const { headerH, headerSlot, expanded, body } = opts;
  const bodyHeight = expanded && body ? body.height : 0;
  return {
    height: headerH + bodyHeight,
    width: 0,
    layout: {
      kind: 'collapsible',
      headerH,
      headerTop: 0,
      bodyTop: headerH,
      expanded,
      child: body ?? null,
      headerSlot,
    },
  };
}

// ── scrollWindow ──────────────────────────────────────────────────────────────

/**
 * Clip a potentially-tall child to a fixed-height viewport.
 *
 * The returned `height` is `min(child.height, maxH)`.  The rendered viewport
 * shows a scrollable window of the child content up to `maxH` px.
 *
 * `overlay`           — optional decorative fade (see WindowLayout).
 * `autoScrollBottom`  — when true, ProjectWindow scrolls to bottom on resize.
 */
export function scrollWindow<L>(
  child: Measured<L>,
  maxH: number,
  opts: { overlay?: 'fade-top' | 'fade-bottom'; autoScrollBottom?: boolean } = {}
): Measured<WindowLayout<L>> {
  return {
    height: Math.min(child.height, maxH),
    width: child.width,
    layout: {
      kind: 'window',
      maxH,
      child,
      overlay: opts.overlay,
      autoScrollBottom: opts.autoScrollBottom,
    },
  };
}

// ── slot ──────────────────────────────────────────────────────────────────────

/**
 * All named slot placeholders used across the built-in ComponentDefs.
 *
 * Add a new entry here when adding a new row kind that uses slots, then use
 * the constant in both the def's `slot(...)` call and its Render `slots` map.
 * This gives autocomplete and catches typos at compile time.
 */
export const SLOT_NAMES = {
  MESSAGE_FOOTER: 'message:footer',
  THINKING_HEADER: 'thinking:header',
  FILE_OP_ROW: 'file-op:row',
  FILE_OP_HEADER: 'file-op:header',
  FILE_OP_LIST: 'file-op:list',
  FILE_OP_PREVIEW: 'file-op:preview',
  DIFF_HEADER: 'diff:header',
  DIFF_BODY: 'diff:body',
  PLAN_HEADER: 'plan:header',
  PLAN_LIST: 'plan:list',
} as const;

export type SlotName = (typeof SLOT_NAMES)[keyof typeof SLOT_NAMES];

/**
 * Create a named placeholder node for non-generic chrome.
 *
 * The `height` must equal the real rendered height of the chrome so the
 * containing `stack`'s total height is correct.
 */
export function slot(name: SlotName | string, height: number): Measured<SlotLayout> {
  return {
    height,
    width: 0,
    layout: { kind: 'slot', name, height },
  };
}
