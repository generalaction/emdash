/**
 * planUnitDef — native UnitDef for ChatPlan rows.
 *
 * Single self-contained unit: measure returns a total height (number),
 * and Render computes entries and heights from measureCtx and renders
 * PlanHeader + PreviewWindow/PlanList directly.
 *
 * Collapse semantics use inverted mode: the stored "collapsed" view-state flag
 * means "expanded", so the plan starts collapsed (no flag) and expands on click.
 */

import { Show, createMemo } from 'solid-js';
import type { StackLayout } from '../../core/compose';
import { type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import { layoutBlockStack } from '../../core/layout/block-stack';
import { ROW_H } from '../../core/metrics';
import { defineUnit } from '../../core/units';
import type { ChatPlan, PlanEntryPriority, PlanEntryStatus } from '../../model';
import { PreviewWindow } from '../primitives/PreviewWindow';
import { PlanHeader, PlanList } from './Plan';
import {
  PLAN_BORDER,
  PLAN_ENTRY_GAP,
  PLAN_ENTRY_INDENT,
  PLAN_ICON_BOX,
  PLAN_ICON_GAP,
  PLAN_PAD_X,
  PLAN_PAD_Y,
  PLAN_WINDOW_H,
} from './plan-metrics';

export {
  PLAN_BORDER,
  PLAN_ENTRY_GAP,
  PLAN_ENTRY_INDENT,
  PLAN_ICON_BOX,
  PLAN_ICON_GAP,
  PLAN_PAD_X,
  PLAN_PAD_Y,
  PLAN_WINDOW_H,
};

/** Total horizontal + vertical chrome added by the card border + outer padding. */
// Vertical: top border (PLAN_BORDER) + header separator (PLAN_BORDER) + bottom border (PLAN_BORDER).
// The outer wrapper no longer has vertical padding; PLAN_OUTER_PAD_Y now only applies
// to the body content via PLAN_PAD_Y.
const CHROME_Y = 3 * PLAN_BORDER;
const CHROME_X = 2 * PLAN_PAD_X + 2 * PLAN_BORDER;

// ── Layout type ───────────────────────────────────────────────────────────────

export type PlanEntryLaid = {
  /** Pre-measured block stack for this entry's content. */
  measured: Measured<StackLayout>;
  status: PlanEntryStatus;
  priority: PlanEntryPriority;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Lay out each entry's content into a measured block stack. */
function measureEntries(item: ChatPlan, ctx: MeasureCtx): PlanEntryLaid[] {
  const bodyWidth = ctx.width - CHROME_X - PLAN_ENTRY_INDENT;
  return item.entries.map((entry, i) => {
    const blocks = ctx.caches.parseBlocks(`${item.id}:e${i}`, entry.content);
    const measured = layoutBlockStack(
      blocks,
      { ...ctx, width: bodyWidth },
      { padY: 0, blockGap: 4, proseGap: 2 }
    );
    return { measured, status: entry.status, priority: entry.priority };
  });
}

function listHeight(entries: PlanEntryLaid[]): number {
  const totalEntryH = entries.reduce((sum, e) => sum + e.measured.height, 0);
  const gaps = entries.length > 1 ? (entries.length - 1) * PLAN_ENTRY_GAP : 0;
  return totalEntryH + gaps + 2 * PLAN_PAD_Y;
}

// ── Native UnitDef (Phase 2) ───────────────────────────────────────────────────
//
// Self-contained: measure returns a number; Render computes entries and heights
// from measureCtx and renders PlanHeader + PreviewWindow/PlanList directly
// without Project slots.

function planMeasure(item: ChatPlan, ctx: MeasureCtx): number {
  const headerH = ROW_H;
  const isExpanded = ctx.expanded(item.id);
  const entries = measureEntries(item, ctx);
  const listH = listHeight(entries);
  const bodyH = isExpanded ? listH : Math.min(listH, PLAN_WINDOW_H);
  return headerH + bodyH + CHROME_Y;
}

function PlanUnitRender(props: { data: ChatPlan; ctx: RenderCtx }) {
  const mCtx = () => props.ctx.measureCtx?.();
  // Inverted semantics: stored "collapsed" bool = "expanded".
  const isExpanded = () => props.ctx.viewState.isCollapsed(props.data.id);

  const entries = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return [];
    return measureEntries(props.data, ctx);
  });

  const listH = createMemo(() => listHeight(entries()));
  const bodyH = createMemo(() => (isExpanded() ? listH() : Math.min(listH(), PLAN_WINDOW_H)));

  const totalH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return ROW_H + CHROME_Y;
    return planMeasure(props.data, ctx);
  });

  const autoScroll = () => !!props.data.streaming;

  return (
    <div
      class="border-chat-border rounded-lg border overflow-hidden"
      style={{ height: `${totalH()}px`, 'box-sizing': 'border-box' }}
    >
      <PlanHeader item={props.data} expanded={isExpanded()} rowH={ROW_H} />
      {/* Body wrapper carries the horizontal padding so content is not flush with the card border. */}
      <div style={{ 'padding-left': `${PLAN_PAD_X}px`, 'padding-right': `${PLAN_PAD_X}px` }}>
        <Show
          when={!isExpanded()}
          fallback={
            // Expanded: full untruncated list
            <PlanList
              entries={entries()}
              padY={PLAN_PAD_Y}
              entryGap={PLAN_ENTRY_GAP}
              iconBox={PLAN_ICON_BOX}
              iconGap={PLAN_ICON_GAP}
            />
          }
        >
          {/* Collapsed: wrap the same list in a capped preview window */}
          <PreviewWindow
            height={bodyH()}
            maxH={PLAN_WINDOW_H}
            overlay="fade-bottom"
            autoScrollBottom={autoScroll()}
            contentHeight={() => listH()}
          >
            <PlanList
              entries={entries()}
              padY={PLAN_PAD_Y}
              entryGap={PLAN_ENTRY_GAP}
              iconBox={PLAN_ICON_BOX}
              iconGap={PLAN_ICON_GAP}
            />
          </PreviewWindow>
        </Show>
      </div>
    </div>
  );
}

export const planUnitDef = defineUnit<ChatPlan>({
  kind: 'plan',

  estimate(item, ctx): number {
    const headerH = ROW_H;
    const isExpanded = ctx.expanded(item.id);
    const lineH = ctx.theme.fonts.body.lineHeight;
    const entryH = 2 * lineH;
    const gaps = item.entries.length > 1 ? (item.entries.length - 1) * PLAN_ENTRY_GAP : 0;
    const listH = item.entries.length * entryH + gaps + 2 * PLAN_PAD_Y;
    const bodyH = isExpanded ? listH : Math.min(listH, PLAN_WINDOW_H);
    return headerH + bodyH + CHROME_Y;
  },

  measure: planMeasure,

  Render: PlanUnitRender,
});
