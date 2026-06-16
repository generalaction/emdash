/**
 * Spec-types — shared interfaces for the per-component spec pattern.
 *
 * Two tiers:
 *   BlockSpec<TBlock, TLaid>  — one per block kind (prose / code / island)
 *   RowComponent<TItem, TLayout> — one per row kind (message / tool / thinking)
 *
 * These types live in core/ because they reference FontConfig and the layout
 * types, which are core primitives. They import nothing from components/.
 */

import type { Component } from 'solid-js';
import type { FontConfig } from '../measure/fonts';
import type { BlockLaidOut } from './layout-types';

// ── Shared contexts ───────────────────────────────────────────────────────────

/**
 * Read-only inputs available to every measure / layout call.
 * Passed by Row (for rows) and by the message orchestrator (for blocks).
 */
export type MeasureCtx = {
  fonts: FontConfig;
  rowWidth: number;
  isCollapsed: (id: string) => boolean;
  measured: (id: string) => number | undefined;
};

/**
 * Mutable callbacks available to every Render component.
 * Passed from Row.tsx through props.ctx.
 */
export type RenderCtx = {
  viewState: { isCollapsed: (id: string) => boolean };
  setMeasured: (id: string, h: number) => void;
};

// ── Block tier ────────────────────────────────────────────────────────────────

/**
 * Per block-kind spec: geometry constants, CSS variable contribution, and pure
 * layout function. No DOM access; no Solid primitives.
 *
 * TBlock  — the parse-blocks input type (ProseBlock, CodeBlock, IslandBlock)
 * TLaid   — the layout-types output type (ProseLaidOut, CodeLaidOut, IslandLaidOut)
 */
export interface BlockSpec<TBlock, TLaid extends BlockLaidOut> {
  /**
   * Geometry constants that drive both layout arithmetic and CSS variables.
   * Changing a value here propagates to both.
   */
  readonly metrics: Readonly<Record<string, number>>;

  /**
   * CSS custom properties contributed by this block kind.
   * Values are derived directly from `this.metrics` + shared typography,
   * so they never drift from the layout constants.
   */
  cssVars(): Record<string, string>;

  /**
   * Pure, DOM-free geometry. Called only for visible rows; may use pretext.
   */
  layout(
    block: TBlock,
    fonts: FontConfig,
    top: number,
    width: number,
    measured?: number
  ): TLaid;
}

// ── Row tier ──────────────────────────────────────────────────────────────────

/**
 * Per row-kind spec: cheap estimate (used for all N rows at setCount),
 * exact measure (used for visible rows), CSS vars, and the Solid renderer.
 *
 * TItem   — ChatMessage | ChatToolCall | ChatThinking
 * TLayout — { height: number; ... } produced by measure, consumed by Render
 */
export interface RowComponent<TItem, TLayout extends { height: number }> {
  /**
   * Cheap height estimate — must run in O(1) arithmetic; no pretext / DOM.
   * Called for every row in the list at setCount time (potentially 10k rows).
   */
  estimate(item: TItem, ctx: MeasureCtx): number;

  /**
   * Exact layout — may call layoutMessage / pretext. Called only for visible rows.
   * Returns the layout object passed directly to Render.
   */
  measure(item: TItem, ctx: MeasureCtx): TLayout;

  /**
   * Solid component. Receives (item, layout, ctx) and renders content only —
   * outer positioning is handled by the Row wrapper in ChatRoot.
   */
  Render: Component<{ item: TItem; layout: TLayout; ctx: RenderCtx }>;
}
