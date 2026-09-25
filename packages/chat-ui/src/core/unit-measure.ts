/**
 * measureUnitCached — the unit-level measure memo ("nodeMemo").
 *
 * WeakMap keyed by `unit.data` object identity. Committed units keep their
 * data objects across streaming ticks (flatten only rebuilds the committed
 * tier on committed-turn changes, and parse caches keep Block identities
 * stable), so re-entrant measure calls from UnitRow re-runs and the prefetch
 * path become cache hits instead of full stack re-measures. Streaming units
 * whose data payload is rebuilt each tick miss the cache — which is correct,
 * their content changed.
 *
 * Invalidation has two parts:
 *
 *   Base fingerprint — `kind|measureEpoch|width|expandedId-relevance`.
 *     `expandedId` enters only as "does it point at THIS unit" — the MeasureCtx
 *     contract (core/define.ts) is that defs may compare `ctx.expandedId`
 *     against their own item id only, so a toggle between two other rows
 *     cannot change this unit's height.
 *
 *   Recorded collapse reads — every `ctx.isCollapsed(id)` / `ctx.expanded(id)`
 *     call made during measure is recorded with its value. A lookup re-reads
 *     the recorded ids and misses when any value changed. Re-reading on hits
 *     also preserves SolidJS dependency tracking: a memo that hits the cache
 *     still subscribes to exactly the collapse signals that affect its height.
 *     This makes the memo safe for defs that never declared `collapseIds`.
 */

import type { MeasureCtx } from './define';
import type { RenderUnit, UnitDef } from './units';

type CollapseRead = {
  /** Which ctx accessor the read went through. */
  source: 'isCollapsed' | 'expanded';
  id: string;
  value: boolean;
};

type UnitMemoEntry = {
  base: string;
  reads: CollapseRead[];
  contentH: number;
};

const unitMemo = new WeakMap<object, UnitMemoEntry>();

function baseFingerprint(unit: RenderUnit, ctx: MeasureCtx): string {
  const expandedSelf = ctx.expandedId != null && ctx.expandedId === unit.itemId ? 'E' : '-';
  return `${unit.kind}|${ctx.measureEpoch ?? 0}|${ctx.width}|${expandedSelf}`;
}

function readsStillValid(reads: CollapseRead[], ctx: MeasureCtx): boolean {
  for (const read of reads) {
    const current =
      read.source === 'isCollapsed' ? ctx.isCollapsed(read.id) : ctx.expanded(read.id);
    if (current !== read.value) return false;
  }
  return true;
}

/**
 * Measure a unit's content height through the WeakMap memo.
 *
 * Returns the same number `def.measure(unit.data, ctx, def.vars)` would, but
 * skips the measure when data identity, the base fingerprint, and all collapse
 * reads recorded by the previous measure are unchanged.
 */
export function measureUnitCached(
  unit: RenderUnit,
  ctx: MeasureCtx,
  def: UnitDef<unknown, Record<string, number>> | undefined
): number {
  if (!def) return 0;

  const data = unit.data;
  const cacheable = typeof data === 'object' && data !== null;
  const base = baseFingerprint(unit, ctx);

  if (cacheable) {
    const cached = unitMemo.get(data);
    if (cached && cached.base === base && readsStillValid(cached.reads, ctx)) {
      return cached.contentH;
    }
  }

  // Miss: measure through a recording ctx that captures every collapse read.
  const reads: CollapseRead[] = [];
  const seen = new Set<string>();
  const record = (source: CollapseRead['source'], id: string, value: boolean) => {
    const key = `${source}\x00${id}`;
    if (!seen.has(key)) {
      seen.add(key);
      reads.push({ source, id, value });
    }
  };
  const recordingCtx: MeasureCtx = {
    ...ctx,
    isCollapsed: (id) => {
      const value = ctx.isCollapsed(id);
      record('isCollapsed', id, value);
      return value;
    },
    expanded: (id) => {
      const value = ctx.expanded(id);
      record('expanded', id, value);
      return value;
    },
  };

  const contentH = def.measure(data, recordingCtx, def.vars ?? {});
  if (cacheable) unitMemo.set(data, { base, reads, contentH });
  return contentH;
}
