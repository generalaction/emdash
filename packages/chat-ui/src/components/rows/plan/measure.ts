/**
 * measurePlan — pure height arithmetic for ChatPlan rows.
 *
 * No pretext / DOM / Solid imports. Testable in the node Vitest project.
 * All geometry constants come from `planUnitDef.vars`; this file holds only
 * the arithmetic so the same formulas can be exercised in the node test suite.
 */

import { DEFAULT_FONT_CONFIG } from '../../../core/measure/fonts';
import type { ChatPlan } from '../../../model';
import type { PlanVars } from './plan.def';

export function planListHeight(
  entryCount: number,
  entryHeights: number[] = [],
  vars: PlanVars,
): number {
  const heights = entryHeights.length === entryCount ? entryHeights : [];
  const totalEntryH = heights.reduce((sum, h) => sum + h, 0);
  const gaps = entryCount > 1 ? (entryCount - 1) * vars.entryGap : 0;
  return totalEntryH + gaps + 2 * vars.padY;
}

export function measurePlanH(
  item: ChatPlan,
  isExpanded: boolean,
  entryHeights: number[] = [],
  vars: PlanVars,
): number {
  const listH = planListHeight(item.entries.length, entryHeights, vars);
  const bodyH = isExpanded ? listH : Math.min(listH, vars.windowH);
  return vars.rowH + bodyH + 3 * vars.border;
}

export function estimatePlanH(item: ChatPlan, isExpanded: boolean, vars: PlanVars): number {
  const lineH = DEFAULT_FONT_CONFIG.body.lineHeight;
  const n = item.entries.length;
  const entryHeights = Array.from({ length: n }, () => 2 * lineH);
  return measurePlanH(item, isExpanded, entryHeights, vars);
}
