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

import { ROW_INSET_X } from '../core/metrics';
import type { GroupChrome, ItemSegmenter, UnitDef } from '../core/units';
import { unit } from '../core/units';
import type { ChatItem } from '../model';
import { diffUnitDef } from './diff/diff.def';
import { executeUnitDef } from './execute/execute.def';
import { fileOpUnitDef } from './file-op/file-op.def';
import { messageUnitDef } from './message/message.def';
import { planUnitDef } from './plan/plan.def';
import { resourceLinkUnitDef } from './resource-link/resource-link.def';
import { thinkingUnitDef } from './thinking/thinking.def';
import { toolUnitDef } from './tool/tool.def';

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
  message: nativePassthrough('message', COMPOSITE_CHROME),
  tool: nativePassthrough('tool', COMPOSITE_CHROME),
  thinking: nativePassthrough('thinking', COMPOSITE_CHROME),
  'file-op': nativePassthrough('file-op', COMPOSITE_CHROME),
  execute: nativePassthrough('execute', COMPOSITE_CHROME),
  diff: nativePassthrough('diff', COMPOSITE_CHROME),
  'resource-link': nativePassthrough('resource-link', COMPOSITE_CHROME),
  plan: nativePassthrough('plan', COMPOSITE_CHROME),
};

// ── UNIT_REGISTRY ─────────────────────────────────────────────────────────────

/**
 * Maps unit.kind to its UnitDef.
 *
 * message: single-unit def; measure/Render handle block layout internally.
 * Composite item unit defs also handle their own internal layout.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- registry boundary
export const UNIT_REGISTRY: Record<string, UnitDef<any>> = {
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
};
