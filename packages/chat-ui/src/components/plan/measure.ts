/**
 * measurePlan — pure height arithmetic for ChatPlan rows.
 *
 * No pretext / DOM / Solid imports. Testable in the node Vitest project.
 *
 * Constants match those in `planUnitDef.vars` (plan.def.tsx). Both define the
 * same values so the geometry stays consistent between test arithmetic and the
 * live measure function.
 *
 * Total height = headerH + bodyH + CHROME_Y, where:
 *   - CHROME_Y = 3*PLAN_BORDER (top border + header separator + bottom border)
 *   - bodyH (expanded)  = listH
 *   - bodyH (collapsed) = min(listH, PLAN_WINDOW_H)  (capped preview window)
 *   - listH = sum(entryHeights) + (n-1)*PLAN_ENTRY_GAP + 2*PLAN_PAD_Y
 *
 * measurePlanH accepts an optional `entryHeights` array (px per entry).
 * When omitted (or length-mismatched) every entry is treated as 0px — useful
 * for tests that verify the structural arithmetic before layout runs.
 */

import { DEFAULT_FONT_CONFIG } from '../../core/measure/fonts';
import { ROW_H } from '../../core/metrics';
import type { ChatPlan } from '../../model';

// ── Constants (mirrors planUnitDef.vars) ─────────────────────────────────────

/** Vertical padding (px) inside the expanded entry list, applied top and bottom. */
export const PLAN_PAD_Y = 6;

/** Width (px) of the status-icon box to the left of each entry body (matches the 14px icon). */
export const PLAN_ICON_BOX = 14;

/** Horizontal gap (px) between the status icon and the entry text. */
export const PLAN_ICON_GAP = 8;

/** Total horizontal inset (px) consumed left of the entry body: icon box + gap. */
export const PLAN_ENTRY_INDENT = PLAN_ICON_BOX + PLAN_ICON_GAP;

/** Vertical gap (px) between consecutive plan entries. */
export const PLAN_ENTRY_GAP = 4;

/** Border width (px) of the plan card. Matches the rendered `border` class. */
export const PLAN_BORDER = 1;

/** Horizontal padding (px) inside the plan card border, each side. */
export const PLAN_PAD_X = 8;

/** Vertical padding (px) inside the plan card border, top and bottom. */
export const PLAN_OUTER_PAD_Y = 6;

/**
 * Maximum height (px) of the collapsed preview window. When collapsed, the
 * entry list is clipped to this height and (while streaming) auto-scrolls to
 * the bottom so newly-added tasks stay visible.
 */
export const PLAN_WINDOW_H = 96;

// ── Derived constants ─────────────────────────────────────────────────────────

export const PLAN_HEADER_H = ROW_H;
export const PLAN_LINE_H = DEFAULT_FONT_CONFIG.body.lineHeight;

/** Card border: top border + header separator + bottom border. */
export const PLAN_CHROME_Y = 3 * PLAN_BORDER;

// ── Pure arithmetic helpers ───────────────────────────────────────────────────

/** Inner list height: entry heights + inter-entry gaps + list padding. */
export function planListHeight(entryCount: number, entryHeights: number[] = []): number {
  const heights = entryHeights.length === entryCount ? entryHeights : [];
  const totalEntryH = heights.reduce((sum, h) => sum + h, 0);
  const gaps = entryCount > 1 ? (entryCount - 1) * PLAN_ENTRY_GAP : 0;
  return totalEntryH + gaps + 2 * PLAN_PAD_Y;
}

/**
 * Total pixel height for a plan row.
 *
 * @param item         The ChatPlan data item.
 * @param isExpanded   True when the full list is shown; false shows the capped preview.
 * @param entryHeights Per-entry heights in px (defaults to 0 for each entry).
 */
export function measurePlanH(
  item: ChatPlan,
  isExpanded: boolean,
  entryHeights: number[] = []
): number {
  const listH = planListHeight(item.entries.length, entryHeights);
  const bodyH = isExpanded ? listH : Math.min(listH, PLAN_WINDOW_H);
  return PLAN_HEADER_H + bodyH + PLAN_CHROME_Y;
}

/**
 * Cheap estimate of the total height (mirrors planDef.estimate()).
 * Uses 2 body lines per entry as a heuristic for off-screen rows.
 */
export function estimatePlanH(item: ChatPlan, isExpanded: boolean): number {
  const n = item.entries.length;
  const entryHeights = Array.from({ length: n }, () => 2 * PLAN_LINE_H);
  return measurePlanH(item, isExpanded, entryHeights);
}
