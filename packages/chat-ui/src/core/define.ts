/**
 * Core component-definition primitives.
 *
 * Replaces the two-tier `BlockSpec` / `RowComponent` pattern from
 * `core/layout/spec-types.ts` with a single `ComponentDef<TNode, L>` shape
 * that covers both row kinds (message, tool, thinking, …) and block tiers
 * (prose, code, table).
 *
 * Key types:
 *   Measured<L>      — universal measurement result: height + width + typed layout.
 *   MeasureCtx       — read-only inputs for every estimate / measure call.
 *   RenderCtx        — mutable callbacks available to every Render component.
 *   ComponentDef     — the declarative definition of one component kind.
 *   defineComponent  — identity factory; enables inference + documentation.
 *
 * ── State split (Lane A vs Lane B) ──────────────────────────────────────────
 *
 * Lane A — layout-affecting state. These are the ONLY inputs that must be
 * reflected in `MeasureCtx`, in the memo fingerprint in `cachedMeasure`
 * (Row.tsx), and can legitimately cause `virt.setSize` to be called:
 *   • `ctx.width`          — available column width (px)
 *   • `ctx.theme.version`  — theme version token
 *   • `ctx.expanded(id)`   — resolved collapse state for collapsible defs
 *
 * Lane B — presentational / ephemeral state. These must NEVER enter `measure`
 * or the memo fingerprint because they do not affect height:
 *   • copied state (Message.tsx code block copy button)
 *   • hover / focus state
 *   • shimmer / loading animation flags
 *   • selection state
 *   • timer ticks
 *
 * Rule: Lane B state lives as local SolidJS signals in `Render` components
 * (or their children) and is never passed into a `MeasureCtx` nor stored in
 * any shared observable that `measure` or `estimate` reads.
 *
 * Adding a new input to `measure` requires adding it to `MeasureCtx` AND to
 * the fingerprint string in `cachedMeasure` — this is the deliberate friction
 * that keeps Lane A and Lane B separate.
 */

import type { Component } from 'solid-js';
import type { ChatCaches } from './caches';
import type { ChatTheme } from './theme';

// ── Measured ──────────────────────────────────────────────────────────────────

/**
 * Universal measurement output.
 *
 * Every `measure` call returns this shape.  `layout` is a discriminated payload
 * typed per component —
 * the generic `Project` renderer walks it by `layout.kind`.
 *
 * `width` is the natural content width (used by the user-bubble hug algorithm);
 * for most rows it equals the available container width.
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
 * `theme`       — full ChatTheme (fonts + density); replaces the bare
 *                 `FontConfig` that was threaded through the old `MeasureCtx`.
 * `width`       — available horizontal space in px; replaces `rowWidth`.
 * `isCollapsed` — raw view-state collapse flag (for block-level collapse).
 * `expanded`    — engine-resolved "is expanded" for the row. For normal
 *                 collapse mode, `true` when the view-state flag is set.
 *                 For inverted mode (thinking, file-op), `true` when the
 *                 view-state flag is NOT set (i.e. not in the collapsed state).
 *                 Defs that declare `collapse` should read this instead of
 *                 calling `isCollapsed` directly.
 */
export type MeasureCtx = {
  theme: ChatTheme;
  width: number;
  isCollapsed: (id: string) => boolean;
  expanded: (id: string) => boolean;
  caches: ChatCaches;
};

/**
 * Mutable callbacks available to every Render component.
 * Re-exported here so importers only need one import path.
 */
export type RenderCtx = {
  viewState: { isCollapsed: (id: string) => boolean };
};

// ── ComponentDef ──────────────────────────────────────────────────────────────

/**
 * Declarative collapse behavior for a ComponentDef.
 *
 * `mode`:
 *   - `'normal'`   — `ctx.expanded(id)` is `true` when the view-state flag
 *                    `isCollapsed(id)` is set (i.e. collapsed stores "expanded").
 *   - `'inverted'` — `ctx.expanded(id)` is `true` when the view-state flag is
 *                    NOT set. Use for thinking/file-op rows where the stored
 *                    "collapsed" bool actually means "expanded".
 * `default`:
 *   The resolved `expanded` value when the view-state has no entry for the id.
 *   Typical: `false` (start collapsed/minimal).
 */
export type CollapseDecl = {
  mode: 'normal' | 'inverted';
  default: boolean;
};

/**
 * Declarative definition of one component kind.
 *
 * TNode    — the data node type (ChatMessage, ProseBlock, …)
 * L        — the typed layout payload carried inside `Measured<L>`
 *
 * `kind`     — matches the discriminator used in REGISTRY keys and layout.kind.
 * `padY`     — optional symmetric vertical padding (px) applied to the row wrapper
 *              by the engine. Defaults to 0.
 * `collapse` — optional declarative collapse behavior. When present, Row.tsx
 *              resolves `ctx.expanded(id)` using `collapse.mode` and includes
 *              the result in the memo fingerprint. Defs without `collapse`
 *              should not call `ctx.expanded`.
 * `estimate` — optional O(1) height heuristic used for off-screen rows at
 *              `setCount` / `prepend` time. Omit for simple constant-height or
 *              single-line-text kinds; the engine falls back to `genericEstimate`
 *              (text-length lines × lineHeight) which is corrected to an exact
 *              height the moment the row enters the visible window. Implement it
 *              when the generic default would be materially wrong — e.g.
 *              collapsible kinds (expanded vs collapsed differ greatly), kinds
 *              with fixed chrome (footer, header, border) that the generic formula
 *              omits, or hug-width bubbles.
 * `measure`  — exact layout; called only for visible rows; may use pretext.
 * `Render`   — Solid component; receives item, Measured layout, and RenderCtx.
 */
export type ComponentDef<TNode, L> = {
  kind: string;
  /** Symmetric vertical padding (px) applied to the row wrapper. Defaults to 0. */
  padY?: number;
  /** Optional declarative collapse; engine resolves ctx.expanded(id) from this. */
  collapse?: CollapseDecl;
  estimate?(node: TNode, ctx: MeasureCtx): number;
  measure(node: TNode, ctx: MeasureCtx): Measured<L>;
  Render: Component<{ item: TNode; layout: Measured<L>; ctx: RenderCtx }>;
};

/**
 * Identity factory that lets TypeScript infer the generic parameters while
 * also serving as a documentation anchor for component definitions.
 *
 * Usage:
 *   export const executeDef = defineComponent<ChatExecute, ExecuteLayout>({ … });
 */
export function defineComponent<TNode, L>(def: ComponentDef<TNode, L>): ComponentDef<TNode, L> {
  return def;
}
