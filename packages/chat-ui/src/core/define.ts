/**
 * Core component-definition primitives.
 *
 * Replaces the two-tier `BlockSpec` / `RowComponent` pattern from
 * `core/layout/spec-types.ts` with a single `ComponentDef<TNode, L>` shape
 * that covers both row kinds (message, tool, thinking, …) and block tiers
 * (prose, code, table, island).
 *
 * Key types:
 *   Measured<L>      — universal measurement result: height + width + typed layout.
 *   MeasureCtx       — read-only inputs for every estimate / measure call.
 *   RenderCtx        — mutable callbacks available to every Render component.
 *   ComponentDef     — the declarative definition of one component kind.
 *   defineComponent  — identity factory; enables inference + documentation.
 */

import type { Component } from 'solid-js';
import type { ChatTheme } from './theme';

// ── Measured ──────────────────────────────────────────────────────────────────

/**
 * Universal measurement output.
 *
 * Every `estimate` and `measure` call returns this shape (or just a `number`
 * for `estimate`).  `layout` is a discriminated payload typed per component —
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
 * Read-only inputs available to every `estimate` and `measure` call.
 *
 * `theme`       — full ChatTheme (fonts + geometry); replaces the bare
 *                 `FontConfig` that was threaded through the old `MeasureCtx`.
 * `width`       — available horizontal space in px; replaces `rowWidth`.
 * `isCollapsed` — queries the view-state collapse flag by item/block id.
 * `measured`    — queries DOM-measured heights (for island write-back).
 */
export type MeasureCtx = {
  theme: ChatTheme;
  width: number;
  isCollapsed: (id: string) => boolean;
  measured: (id: string) => number | undefined;
};

/**
 * Mutable callbacks available to every Render component.
 * Unchanged from the old `RenderCtx`; re-exported here so importers only
 * need one import path.
 */
export type RenderCtx = {
  viewState: { isCollapsed: (id: string) => boolean };
  setMeasured: (id: string, h: number) => void;
};

// ── ComponentDef ──────────────────────────────────────────────────────────────

/**
 * Declarative definition of one component kind.
 *
 * TNode — the data node type (ChatMessage, ProseBlock, …)
 * L     — the typed layout payload carried inside `Measured<L>`
 *
 * `kind`     — matches the discriminator used in REGISTRY keys and layout.kind.
 * `estimate` — O(1) height heuristic; called for every row at `setCount` time.
 * `measure`  — exact layout; called only for visible rows; may use pretext.
 * `Render`   — Solid component; receives item, Measured layout, and RenderCtx.
 */
export type ComponentDef<TNode, L> = {
  kind: string;
  estimate(node: TNode, ctx: MeasureCtx): number;
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
