/**
 * Core definition primitives.
 *
 * Key types:
 *   Measured<L>  — universal measurement result: height + width + typed layout.
 *   MeasureCtx   — read-only inputs for every estimate / measure call.
 *   RenderCtx    — callbacks available to every Render component.
 *
 * ── State split (Lane A vs Lane B) ──────────────────────────────────────────
 *
 * Lane A — layout-affecting state. These are the ONLY inputs that must be
 * reflected in `MeasureCtx` and can legitimately cause `virt.setSize` to be called:
 *   • `ctx.width`          — available column width (px)
 *   • `ctx.theme.version`  — theme version token
 *   • `ctx.expanded(id)`   — resolved collapse state for collapsible defs
 *   • `ctx.measureEpoch`   — bumped after font load to invalidate blockMemo
 *
 * Lane B — presentational / ephemeral state. These must NEVER enter `measure`
 * or any height fingerprint because they do not affect height:
 *   • copied state (code block copy button)
 *   • hover / focus state
 *   • shimmer / loading animation flags
 *   • selection state
 *   • timer ticks
 */

import type { ChatCaches } from './caches';
import type { ChatTheme } from './theme';

// ── Measured ──────────────────────────────────────────────────────────────────

/**
 * Universal measurement output.
 *
 * `layout` is a discriminated payload typed per component.
 * `width` is the natural content width; for most rows it equals the available
 * container width.
 */
export type Measured<L = unknown> = {
  height: number;
  width: number;
  layout: L;
};

// ── Contexts ──────────────────────────────────────────────────────────────────

/**
 * Read-only inputs available to every `measure` call (and optional `estimate`).
 *
 * `theme`        — full ChatTheme (fonts + density).
 * `width`        — available horizontal space in px.
 * `isCollapsed`  — raw view-state collapse flag (for block-level collapse).
 * `expanded`     — engine-resolved "is expanded" for the row. For native UnitDef
 *                  composites, `expanded(id)` = `isCollapsed(id)` (inverted
 *                  semantics: stored "collapsed" flag means "expanded").
 * `measureEpoch` — optional monotonic counter bumped after fonts load to force
 *                  `blockMemo` cache misses even when theme.version/width are
 *                  unchanged. This clears fallback-font geometry and prevents
 *                  `contain: paint` from clipping under-measured content.
 */
export type MeasureCtx = {
  theme: ChatTheme;
  width: number;
  isCollapsed: (id: string) => boolean;
  expanded: (id: string) => boolean;
  caches: ChatCaches;
  measureEpoch?: number;
};

/**
 * Callbacks available to every Render component.
 *
 * `viewState`   — collapse / toggle callbacks.
 * `measureCtx`  — optional reactive accessor supplying the lane-A MeasureCtx
 *                 for this unit (set by UnitRow for native UnitDef renders).
 *                 Native UnitDef.Render components call `props.ctx.measureCtx?.()`
 *                 to access theme, width, and caches for re-measuring inside
 *                 the render (e.g. leaf blocks after `measureBlockCached`).
 */
export type RenderCtx = {
  viewState: { isCollapsed: (id: string) => boolean };
  measureCtx?: () => MeasureCtx;
};
