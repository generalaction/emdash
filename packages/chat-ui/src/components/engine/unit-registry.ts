/**
 * unit-registry — segmenter and unit-def registries for the flat unit engine.
 *
 * Two independent maps:
 *
 *   SEGMENTERS   — ChatItem.kind → ItemSegmenter
 *                  Defines how each transcript item is split into RenderUnits.
 *
 *   UNIT_REGISTRY — unit.kind → UnitDef
 *                   Defines how each unit kind is measured and rendered.
 *
 * Adding a new ChatItem kind:
 *   1. Implement a UnitDef<D> and an ItemSegmenter in the appropriate folder.
 *   2. Register the segmenter in SEGMENTERS.
 *   3. Register the UnitDef in UNIT_REGISTRY.
 */

import { messageUnitDef } from '@components/rows/message/message.def';
import { planUnitDef } from '@components/rows/plan/plan.def';
import { resourceLinkUnitDef } from '@components/rows/resource-link/resource-link.def';
import { thinkingUnitDef } from '@components/rows/thinking/thinking.def';
import { diffUnitDef } from '@components/rows/tools/diff/diff.def';
import { executeUnitDef } from '@components/rows/tools/execute/execute.def';
import { fileOpUnitDef } from '@components/rows/tools/file-op/file-op.def';
import { toolGroupUnitDef } from '@components/rows/tools/tool-group/tool-group.def';
import { toolUnitDef } from '@components/rows/tools/tool/tool.def';
import type { GroupChrome, ItemSegmenter, UnitDef } from '@core/units';
import { unit } from '@core/units';
import type { ItemNode, NodeSegmenter } from '@state/flatten';
import type { ChatItem, ChatMessage } from '@/model';
import { ROW_INSET_X } from './row-metrics';

// ── Native single-unit segmenter for composites ───────────────────────────────
//
// Each composite item becomes exactly one RenderUnit with chrome.insetX so
// the native UnitDef.measure receives the same effective width as Row.tsx used.

// oxlint-disable-next-line typescript/no-explicit-any -- registry boundary
function nativePassthrough(kind: ChatItem['kind'], chrome?: GroupChrome): ItemSegmenter<any> {
  return {
    kind,
    chrome,
    // oxlint-disable-next-line typescript/no-explicit-any -- data is ChatItem at runtime
    segment: (item: ChatItem, _ctx: any) => [unit(item.kind, item, item, { key: 'self' })],
  };
}

/** Chrome shared by all non-user-message composite rows (matches legacy Row.tsx inset). */
const COMPOSITE_CHROME: GroupChrome = { insetX: ROW_INSET_X };

/**
 * User message chrome: full column width (no inset). The card border/padding/bg
 * are handled internally by UserMessageCard, so chrome carries only insetX=0.
 */
const USER_CHROME: GroupChrome = { insetX: 0 };

/**
 * Role-aware message segmenter.
 *
 * Each message becomes exactly one unit with key='self'. The chrome is set
 * per-unit (not on the segmenter) so flatten.ts does not overwrite it with a
 * single shared value — user messages get USER_CHROME (full width), all others
 * get COMPOSITE_CHROME (insetX=ROW_INSET_X).
 */
const messageSegmenter: ItemSegmenter<ChatMessage> = {
  kind: 'message',
  // No top-level chrome: we set u.chrome per-unit in segment() below so
  // flatten's chrome-copy pass (which only fires when seg.chrome is truthy)
  // cannot overwrite the per-role value we assigned.
  segment: (item) => {
    const u = unit('message', item, item, { key: 'self' });
    u.chrome = item.role === 'user' ? USER_CHROME : COMPOSITE_CHROME;
    return [u];
  },
};

// ── SEGMENTERS ────────────────────────────────────────────────────────────────

/**
 * Maps ChatItem.kind to its ItemSegmenter.
 *
 * Composites use nativePassthrough with COMPOSITE_CHROME so that their native
 * UnitDef.measure receives the same effective width as the old Row.tsx path
 * (rowWidth - 2 * ROW_INSET_X). The chrome.insetX is applied visually by
 * UnitRow and subtracted from rowWidth before nativeMeasureCtx.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- registry boundary
export const SEGMENTERS: Record<string, ItemSegmenter<any>> = {
  message: messageSegmenter,
  tool: nativePassthrough('tool', COMPOSITE_CHROME),
  thinking: nativePassthrough('thinking', COMPOSITE_CHROME),
  'file-op': nativePassthrough('file-op', COMPOSITE_CHROME),
  execute: nativePassthrough('execute', COMPOSITE_CHROME),
  diff: nativePassthrough('diff', COMPOSITE_CHROME),
  'resource-link': nativePassthrough('resource-link', COMPOSITE_CHROME),
  plan: nativePassthrough('plan', COMPOSITE_CHROME),
};

// ── NODE_SEGMENTERS ───────────────────────────────────────────────────────────

/**
 * Maps ChatItem.kind → NodeSegmenter for items that can be parents.
 *
 * When `flattenTier` discovers that an item has children (other items reference
 * its id via `parentId`), it calls the matching `NodeSegmenter.segmentNode`
 * instead of the regular `ItemSegmenter.segment`. The emitted unit carries the
 * full `ItemNode` (item + children tree) so the composite renderer can recurse.
 */
export const NODE_SEGMENTERS: Record<string, NodeSegmenter> = {
  tool: {
    chrome: COMPOSITE_CHROME,
    segmentNode(node: ItemNode, _ctx) {
      return [unit('tool-group', node.item, node, { key: 'self' })];
    },
  },
  execute: {
    chrome: COMPOSITE_CHROME,
    segmentNode(node: ItemNode, _ctx) {
      return [unit('tool-group', node.item, node, { key: 'self' })];
    },
  },
  'file-op': {
    chrome: COMPOSITE_CHROME,
    segmentNode(node: ItemNode, _ctx) {
      return [unit('tool-group', node.item, node, { key: 'self' })];
    },
  },
  diff: {
    chrome: COMPOSITE_CHROME,
    segmentNode(node: ItemNode, _ctx) {
      return [unit('tool-group', node.item, node, { key: 'self' })];
    },
  },
};

// ── UNIT_REGISTRY ─────────────────────────────────────────────────────────────

/**
 * Maps unit.kind to its UnitDef.
 *
 * message: single-unit def; measure/Render handle block layout internally.
 * Composite item unit defs also handle their own internal layout.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- registry boundary
export const UNIT_REGISTRY: Record<string, UnitDef<any, any>> = {
  // Message unit (single unit per message, renders block stack internally)
  message: messageUnitDef,
  // Composite item units (single-unit per ChatItem kind)
  diff: diffUnitDef,
  plan: planUnitDef,
  thinking: thinkingUnitDef,
  'file-op': fileOpUnitDef,
  tool: toolUnitDef,
  execute: executeUnitDef,
  'resource-link': resourceLinkUnitDef,
  // Hierarchical composite: parent tool call with nested children
  'tool-group': toolGroupUnitDef,
};
