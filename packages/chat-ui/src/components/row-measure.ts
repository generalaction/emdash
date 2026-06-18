/**
 * row-measure — shared measure cache and MeasureCtx helpers for Row and the
 * idle-time prefetch scheduler.
 *
 * Both paths must write to and read from the SAME `nodeMemo` WeakMap so that
 * prefetch cache hits are visible to Row when it mounts.  Centralising here
 * prevents the WeakMap from being duplicated into two modules.
 *
 * Exports:
 *   nodeMemo         — the module-level WeakMap (Row reads, prefetcher writes).
 *   cachedMeasure    — Row-identical measure with fingerprint-keyed caching.
 *   makeResolveExpanded — pure ctx builder for `expanded(id)`, usable outside
 *                      a Solid reactive context (plain callbacks, not createMemo).
 */

import type { Measured, MeasureCtx } from '../core/define';
import type { ChatItem } from '../model';
import type { ViewState } from '../state/view-state';
import { REGISTRY } from './registry';

// ── Identity-based node memo ──────────────────────────────────────────────────
//
// Level 1 cache (this file): WeakMap keyed by the ChatItem object.
//   Skips the entire def.measure() call for committed (non-streaming) items
//   when the fingerprint is unchanged.
//
// Level 2 cache (core/layout/block-stack.ts): WeakMap keyed by Block object.
//   Skips individual block re-measures inside streaming rows.
//
// Fingerprint: theme.version + rowWidth + isCollapsed(item.id) + expanded(item.id)

// oxlint-disable typescript/no-explicit-any -- cache boundary; each kind is type-safe at its own def
export const nodeMemo = new WeakMap<object, { fingerprint: string; result: Measured<any> }>();

export function cachedMeasure(
  item: ChatItem,
  isActiveTurn: boolean,
  ctx: MeasureCtx
): Measured<any> {
  const def = REGISTRY[item.kind as keyof typeof REGISTRY];

  // Always recompute for activeTurn rows (streaming, content changes every tick).
  if (isActiveTurn) return def.measure(item, ctx);

  // Include expanded(id) in the fingerprint only for collapsible defs.
  const expandedBit = def.collapse !== undefined ? ctx.expanded(item.id) : '';
  const fingerprint = `${ctx.theme.version}|${ctx.width}|${ctx.isCollapsed(item.id)}|${expandedBit}`;
  const cached = nodeMemo.get(item);
  if (cached?.fingerprint === fingerprint) return cached.result;

  const result = def.measure(item, ctx);
  nodeMemo.set(item, { fingerprint, result });
  return result;
}
// oxlint-enable typescript/no-explicit-any

/**
 * Build the `expanded(id)` resolver for a given item's def, using a live
 * `ViewState`.  Pure function (no Solid reactive tracking) — suitable for
 * use in effects, idle callbacks, and outside component trees.
 */
export function makeResolveExpanded(item: ChatItem, viewState: ViewState): (id: string) => boolean {
  const def = REGISTRY[item.kind as keyof typeof REGISTRY];
  const collapseDecl = def.collapse;
  if (!collapseDecl) return () => false;

  return (id: string): boolean => {
    const flag = viewState.isCollapsed(id);
    if (collapseDecl.mode === 'inverted') {
      // Inverted: stored "collapsed" flag means "expanded".
      return flag;
    }
    // Normal: expanded when the view-state "collapsed" flag is NOT set.
    return !flag;
  };
}
