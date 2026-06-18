/**
 * measurePlan — pure height arithmetic for ChatPlan rows.
 *
 * No pretext / DOM / Solid imports. Testable in the node Vitest project.
 *
 * PLAN_HEADER_H and PLAN_LINE_H are derived from DEFAULT_FONT_CONFIG so tests
 * have a numeric value at import time.
 *
 * Total height = headerH + bodyH + CHROME_Y, where:
 *   - CHROME_Y = 2*PLAN_OUTER_PAD_Y + 2*PLAN_BORDER (card border + outer padding)
 *   - bodyH (expanded)  = listH
 *   - bodyH (collapsed) = min(listH, PLAN_WINDOW_H)  (capped preview window)
 *   - listH = sum(entryHeights) + (n-1)*PLAN_ENTRY_GAP + 2*PLAN_PAD_Y
 *
 * measurePlanH accepts an optional `entryHeights` array (px per entry).
 * When omitted (or length-mismatched) every entry is treated as 0px — useful
 * for tests that verify the structural arithmetic before layout runs.
 */

import { DEFAULT_FONT_CONFIG } from '../../core/measure/fonts';
import { HEADER_ROW_EXTRA_H } from '../../core/metrics';
import type { ChatPlan } from '../../model';
import {
  PLAN_BORDER,
  PLAN_ENTRY_GAP,
  PLAN_OUTER_PAD_Y,
  PLAN_PAD_Y,
  PLAN_WINDOW_H,
} from './plan-metrics';

export { PLAN_PAD_Y, PLAN_ENTRY_GAP, PLAN_BORDER, PLAN_OUTER_PAD_Y, PLAN_WINDOW_H };

export const PLAN_HEADER_H = DEFAULT_FONT_CONFIG.body.lineHeight + HEADER_ROW_EXTRA_H;
export const PLAN_LINE_H = DEFAULT_FONT_CONFIG.body.lineHeight;

/** Card border + outer padding contributed to the total height. */
export const PLAN_CHROME_Y = 2 * PLAN_OUTER_PAD_Y + 2 * PLAN_BORDER;

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
