/**
 * flatten — segment a transcript into a two-tier UnitsView.
 *
 * flattenTier() is the pure per-tier segmenter. ChatRoot calls it via two
 * tier-scoped createMemos:
 *
 *   committedUnits  — stable; recomputes only when committed() identity
 *                     changes (turn_done / prepend / seed). The framework memo
 *                     replaces the old WeakMap segmentCache.
 *   activeUnits     — recomputes per streaming tick but only over the small
 *                     activeTurn array. No O(total) work during streaming.
 *
 * The two tiers are joined into an UnitsView (virtual concat) that never
 * allocates a full array per tick. All downstream consumers use
 * UnitsView.at(i) / .length instead of direct array access.
 *
 * ── Seam gap ─────────────────────────────────────────────────────────────────
 *
 * The cross-tier boundary seam (last committed unit → first active unit) is
 * resolved by passing the last committed unit's kind as `prevKind` to
 * flattenTier when building activeUnits.
 *
 * ── Identity ─────────────────────────────────────────────────────────────────
 *
 * Segmenters must mint stable unit ids (${itemId}#${key}) so that the SolidJS
 * <For> over visible units never unnecessarily remounts rows, which would lose
 * the nodeMemo / blockMemo measure caches.
 *
 * ── Helpers ───────────────────────────────────────────────────────────────────
 *
 * flattenTier(items, ctx, segmenters, unitDefs?, prevKind?)
 *                               — pure; returns a RenderUnit[] for one tier.
 * UnitsView                     — virtual two-tier concat: .length / .at(i).
 * makeUnitsView(c, a)           — combine committedUnits + activeUnits.
 * collectUserTurnUnits(committed, units)
 *                               — absolute unit indices of the first unit of
 *                                 each committed user-message group; used by
 *                                 ChatRoot for the pinned-header overlay.
 */

import { resolveSeamGap } from '@core/spacing';
import type { GroupChrome, Margin, RenderUnit, SegmentCtx } from '@core/units';
import { stampGroupRoles } from '@core/units';
import type { ChatItem, ChatMessage } from '@/model';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true when the item is a user-role message (boundary seam sentinel). */
function itemIsUser(item: ChatItem): boolean {
  return item.kind === 'message' && (item as ChatMessage).role === 'user';
}

// ── ItemNode ──────────────────────────────────────────────────────────────────

/**
 * A node in the item forest built by `buildItemForest`.
 *
 * `item` is the raw `ChatItem`. `children` are nodes whose `item.parentId`
 * equals `item.id`, in the original transcript order.
 */
export type ItemNode = {
  item: ChatItem;
  children: ItemNode[];
};

/**
 * Build a flat items array into a forest.
 *
 * Returns a Map from item id → `ItemNode` and a Set of child item ids (items
 * that have a valid `parentId` pointing to another item in the same tier).
 * Orphan `parentId` references (pointing outside the tier) are ignored — the
 * orphaned item is treated as a root.
 */
export function buildItemForest(items: readonly ChatItem[]): {
  nodes: Map<string, ItemNode>;
  childIds: Set<string>;
} {
  const nodes = new Map<string, ItemNode>();
  const childIds = new Set<string>();

  for (const item of items) {
    nodes.set(item.id, { item, children: [] });
  }

  for (const item of items) {
    const parentId = (item as { parentId?: string }).parentId;
    if (parentId && nodes.has(parentId)) {
      nodes.get(parentId)!.children.push(nodes.get(item.id)!);
      childIds.add(item.id);
    }
  }

  return { nodes, childIds };
}

// ── flattenTier ───────────────────────────────────────────────────────────────

/** Node segmenter: called instead of `segment()` when the item has children. */
export type NodeSegmenter = {
  segmentNode(node: ItemNode, ctx: SegmentCtx): RenderUnit[];
  chrome?: GroupChrome;
};

/**
 * Segment one tier (committed or activeTurn) into a flat RenderUnit[].
 *
 * `prevKind` is the kind of the last unit from the preceding tier (if any).
 * It is used to resolve the gapBefore of the first unit in this tier against
 * the cross-tier boundary seam. Omit for the committed tier (it is always
 * first).
 *
 * `nodeSegmenters` is an optional map from `ChatItem.kind` to a `NodeSegmenter`
 * that is called *instead* of the regular `segment()` when an item has children
 * (i.e. other items reference it via `parentId`). Child items are consumed by
 * the parent's composite unit and skipped in the top-level iteration.
 */
export function flattenTier(
  items: readonly ChatItem[],
  ctx: SegmentCtx,
  segmenters: Record<
    string,
    { segment(item: ChatItem, ctx: SegmentCtx): RenderUnit[]; chrome?: GroupChrome }
  >,
  unitDefs?: Record<string, { margin?: Margin }>,
  prevKind?: string,
  nodeSegmenters?: Record<string, NodeSegmenter>
): RenderUnit[] {
  const out: RenderUnit[] = [];

  // Hoist stable per-call values so processItem allocates nothing per seam.
  const marginOf = (k: string) => unitDefs?.[k]?.margin;

  // Track the kind of the last emitted unit for seam resolution.
  let lastKind = prevKind;

  // Build the forest when node segmenters are provided so that parent items
  // are routed to the composite path and child items are skipped.
  let childIds: Set<string> | undefined;
  let nodes: Map<string, ItemNode> | undefined;
  if (nodeSegmenters && items.length > 0) {
    const forest = buildItemForest(items);
    if (forest.childIds.size > 0) {
      childIds = forest.childIds;
      nodes = forest.nodes;
    }
  }

  for (const item of items) {
    // Skip items that are children of another item in this tier.
    if (childIds?.has(item.id)) continue;

    // Route parent items (those with children) to the node segmenter.
    const node = nodes?.get(item.id);
    const nodeSeg = node && node.children.length > 0 ? nodeSegmenters?.[item.kind] : undefined;

    let group: RenderUnit[];
    let chrome: GroupChrome | undefined;

    if (nodeSeg) {
      group = nodeSeg.segmentNode(node!, ctx);
      chrome = nodeSeg.chrome;
    } else {
      const seg = segmenters[item.kind];
      if (!seg) continue;
      group = seg.segment(item, ctx);
      chrome = seg.chrome;
    }

    stampGroupRoles(group);
    if (group.length === 0) continue;

    // Copy chrome from the segmenter onto each unit (allows UnitRow to read it
    // without looking up the segmenter). The chrome value is stable (segmenter
    // is module-level, not data-dependent).
    if (chrome) {
      for (const u of group) {
        u.chrome = chrome;
      }
    }

    // Resolve the inter-group gap and assign it to the first unit of each
    // group (except the very first group overall, which gets gapBefore = 0).
    if (lastKind !== undefined) {
      group[0].gapBefore = resolveSeamGap(lastKind, group[0].kind, marginOf);
    }

    lastKind = group[group.length - 1].kind;
    out.push(...group);
  }

  return out;
}

// ── UnitsView ─────────────────────────────────────────────────────────────────

/**
 * Virtual two-tier concatenation of committedUnits + activeUnits.
 *
 * Never allocates a combined array — .at(i) routes by offset. ChatRoot
 * creates one per frame via makeUnitsView(committedUnits(), activeUnits()).
 */
export type UnitsView = {
  readonly length: number;
  at(i: number): RenderUnit | undefined;
};

/** Combine two flat arrays into an UnitsView without allocating a concat. */
export function makeUnitsView(committed: RenderUnit[], active: RenderUnit[]): UnitsView {
  const cl = committed.length;
  return {
    length: cl + active.length,
    at(i) {
      return i < cl ? committed[i] : active[i - cl];
    },
  };
}

// ── collectUserTurnUnits ──────────────────────────────────────────────────────

/**
 * Returns the absolute unit indices of the *first unit* of each committed
 * user-message group, in ascending order.
 *
 * Used by ChatRoot to determine which user-turn to pin in the sticky overlay.
 * User messages are always in the committed tier (turn_done flushes them
 * before any activeTurn content is appended), so this is stable during
 * assistant streaming.
 *
 * Accepts the committed items array directly (no longer needs the full
 * TranscriptState) and a UnitsView for index lookup.
 */
export function collectUserTurnUnits(committed: readonly ChatItem[], units: UnitsView): number[] {
  // Build a set of itemIds for committed user messages.
  const userItemIds = new Set<string>();
  for (const item of committed) {
    if (itemIsUser(item)) userItemIds.add(item.id);
  }

  if (userItemIds.size === 0) return [];

  // Walk the flat unit view once, recording the first unit index per group.
  const result: number[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < units.length; i++) {
    const u = units.at(i);
    if (u && userItemIds.has(u.itemId) && !seen.has(u.itemId)) {
      seen.add(u.itemId);
      result.push(i);
    }
  }
  return result;
}
