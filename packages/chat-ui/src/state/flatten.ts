/**
 * flatten — collapse a TranscriptState into a flat RenderUnit[] array.
 *
 * This is the bridge between the item-keyed transcript store and the
 * unit-indexed virtualizer.  It calls each item's registered segmenter,
 * stamps group roles, and inserts the uniform inter-group gap.
 *
 * ── Caching ───────────────────────────────────────────────────────────────────
 *
 * Committed items have stable object refs (never mutated; replaced wholesale
 * by `produce` on `turn_done`). Their segment output is cached in a WeakMap
 * keyed by the ChatItem object, so re-running flatten on a streaming tick is
 * O(activeTurn) rather than O(total).
 *
 * activeTurn items are mutated in place by `produce`, so their refs are NOT
 * stable across ticks — they bypass the cache and are re-segmented every call.
 *
 * Identity rule: segmenters must mint stable unit ids (${itemId}#${key}) so
 * that the SolidJS <For> over visible units never unnecessarily remounts rows,
 * which would lose the nodeMemo / blockMemo measure caches.
 *
 * ── Helpers ───────────────────────────────────────────────────────────────────
 *
 * unitCount(units)                — total unit count (fast).
 * getUnit(units, i)               — O(1) index lookup.
 * collectUserTurnUnits(state, units)
 *                                 — absolute unit indices of the first unit of
 *                                   each committed user-message group; used by
 *                                   ChatRoot for the pinned-header overlay.
 */

import { DEFAULT_THEME } from '@core/theme';
import type { GroupChrome, RenderUnit, SegmentCtx } from '@core/units';
import { stampGroupRoles } from '@core/units';
import type { ChatItem } from '@/model';
import type { TranscriptState } from './transcript';

// ── Per-item segment cache ─────────────────────────────────────────────────────

/**
 * WeakMap caching the last segment output for committed (stable-ref) items.
 * Key: ChatItem object ref. Value: the RenderUnit[] produced by segment().
 *
 * Module-level so it is shared between ChatRoot's `flatten` memo and the
 * idle prefetch scheduler (same semantics as `nodeMemo` in row-measure.ts).
 */
export const segmentCache = new WeakMap<object, RenderUnit[]>();

// ── flatten ───────────────────────────────────────────────────────────────────

/**
 * Produce a flat RenderUnit[] from the transcript state using the registered
 * segmenters in `SEGMENTERS`.  Called as a SolidJS createMemo in ChatRoot.
 *
 * `SEGMENTERS` is imported lazily at call time to avoid a module cycle:
 * flatten.ts is under `state/` while SEGMENTERS lives in `components/`.
 * The caller (ChatRoot) passes the registry so this module stays pure.
 */
export function flatten(
  state: TranscriptState,
  ctx: SegmentCtx,
  segmenters: Record<
    string,
    { segment(item: ChatItem, ctx: SegmentCtx): RenderUnit[]; chrome?: GroupChrome }
  >
): RenderUnit[] {
  const out: RenderUnit[] = [];
  const committed = state.committed;
  const activeTurn = state.activeTurn;

  const processItem = (item: ChatItem, isActive: boolean): void => {
    const seg = segmenters[item.kind];
    if (!seg) return;

    let group: RenderUnit[];

    if (isActive) {
      // activeTurn items are mutated in place — never cache; always re-segment.
      group = seg.segment(item, ctx);
      stampGroupRoles(group);
    } else {
      // Committed items have stable refs — use the WeakMap cache.
      const cached = segmentCache.get(item);
      if (cached) {
        group = cached;
        // groupRoles are already stamped; no need to re-stamp.
      } else {
        group = seg.segment(item, ctx);
        stampGroupRoles(group);
        segmentCache.set(item, group);
      }
    }

    if (group.length === 0) return;

    // Copy chrome from the segmenter onto each unit (allows UnitRow to read it
    // without looking up the segmenter).  Mutating fresh/cached arrays is fine:
    // the chrome value is stable (segmenter is module-level, not data-dependent).
    const chrome = seg.chrome;
    if (chrome) {
      for (const u of group) {
        u.chrome = chrome;
      }
    }

    // Apply inter-group gap to the first unit of each group (except the very
    // first group in the transcript, which has no preceding row).
    if (out.length > 0 && group.length > 0) {
      group[0].gapBefore = DEFAULT_THEME.density.rowGap;
    }

    out.push(...group);
  };

  for (let i = 0; i < committed.length; i++) {
    processItem(committed[i], false);
  }
  if (activeTurn) {
    for (let i = 0; i < activeTurn.length; i++) {
      processItem(activeTurn[i], true);
    }
  }

  return out;
}

// ── Accessors ─────────────────────────────────────────────────────────────────

/** Total unit count (same as units.length but named for symmetry). */
export function unitCount(units: RenderUnit[]): number {
  return units.length;
}

/** Get the unit at absolute index i. Returns undefined when out of range. */
export function getUnit(units: RenderUnit[], i: number): RenderUnit | undefined {
  return units[i];
}

/**
 * Returns the absolute unit indices of the *first unit* of each committed
 * user-message group, in ascending order.
 *
 * Used by ChatRoot to determine which user-turn to pin in the sticky overlay.
 * Mirrors `collectUserTurnIndices` from state/transcript.ts but operates over
 * the flat unit array.
 *
 * User messages are always in the committed tier (turn_done flushes them
 * before any activeTurn content is appended), so this is stable during
 * assistant streaming.
 */
export function collectUserTurnUnits(state: TranscriptState, units: RenderUnit[]): number[] {
  // Build a set of itemIds for committed user messages.
  const userItemIds = new Set<string>();
  for (const item of state.committed) {
    if (item.kind === 'message' && item.role === 'user') {
      userItemIds.add(item.id);
    }
  }

  if (userItemIds.size === 0) return [];

  // Walk the flat unit array once, recording the first unit index per group.
  const result: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (userItemIds.has(u.itemId) && !seen.has(u.itemId)) {
      seen.add(u.itemId);
      result.push(i);
    }
  }
  return result;
}
