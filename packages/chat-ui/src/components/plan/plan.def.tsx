/**
 * planUnitDef — native UnitDef for ChatPlan rows.
 *
 * Single self-contained unit: measure returns a total height (number),
 * and Render computes entries and heights from measureCtx and renders
 * PlanHeader + PreviewWindow/PlanList directly.
 *
 * Collapse semantics use inverted mode: the stored "collapsed" view-state flag
 * means "expanded", so the plan starts collapsed (no flag) and expands on click.
 *
 * Geometry constants are declared in `vars` — the single source of truth for
 * plan row geometry. The same values are mirrored in measure.ts for node tests.
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

// ── vars type ─────────────────────────────────────────────────────────────────

export type PlanVars = {
  /** Fixed height (px) of the plan header row. */
  rowH: number;
  /** Border width (px) of the plan card. */
  border: number;
  /** Horizontal padding (px) inside the plan card border, each side. */
  padX: number;
  /** Vertical padding (px) inside the expanded entry list, applied top and bottom. */
  padY: number;
  /** Width (px) of the status-icon box to the left of each entry body. */
  iconBox: number;
  /** Horizontal gap (px) between the status icon and the entry text. */
  iconGap: number;
  /** Vertical gap (px) between consecutive plan entries. */
  entryGap: number;
  /** Maximum height (px) of the collapsed preview window. */
  windowH: number;
};

const PLAN_VARS: PlanVars = {
  rowH: ROW_H,
  border: 1,
  padX: 8,
  padY: 6,
  iconBox: 14,
  iconGap: 8,
  entryGap: 4,
  windowH: 96,
};

// ── Layout type ───────────────────────────────────────────────────────────────

export type PlanEntryLaid = {
  /** Pre-measured block stack for this entry's content. */
  measured: Measured<StackLayout>;
  status: PlanEntryStatus;
  priority: PlanEntryPriority;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Total horizontal chrome: 2*padX + 2*border. */
function chromeX(vars: PlanVars): number {
  return 2 * vars.padX + 2 * vars.border;
}

/** Total vertical chrome: top border + header separator + bottom border. */
function chromeY(vars: PlanVars): number {
  return 3 * vars.border;
}

/** Total entry indent: icon box + icon gap. */
function entryIndent(vars: PlanVars): number {
  return vars.iconBox + vars.iconGap;
}

/** Lay out each entry's content into a measured block stack. */
function measureEntries(item: ChatPlan, ctx: MeasureCtx, vars: PlanVars): PlanEntryLaid[] {
  const bodyWidth = ctx.width - chromeX(vars) - entryIndent(vars);
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

function listHeight(entries: PlanEntryLaid[], vars: PlanVars): number {
  const totalEntryH = entries.reduce((sum, e) => sum + e.measured.height, 0);
  const gaps = entries.length > 1 ? (entries.length - 1) * vars.entryGap : 0;
  return totalEntryH + gaps + 2 * vars.padY;
}

// ── UnitDef ───────────────────────────────────────────────────────────────────

function planMeasure(item: ChatPlan, ctx: MeasureCtx, vars: PlanVars): number {
  const headerH = vars.rowH;
  const isExpanded = ctx.expanded(item.id);
  const entries = measureEntries(item, ctx, vars);
  const listH = listHeight(entries, vars);
  const bodyH = isExpanded ? listH : Math.min(listH, vars.windowH);
  return headerH + bodyH + chromeY(vars);
}

function PlanUnitRender(props: { data: ChatPlan; ctx: RenderCtx; vars: PlanVars }) {
  const mCtx = () => props.ctx.measureCtx?.();
  // Inverted semantics: stored "collapsed" bool = "expanded".
  const isExpanded = () => props.ctx.viewState.isCollapsed(props.data.id);

  const entries = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return [];
    return measureEntries(props.data, ctx, props.vars);
  });

  const listH = createMemo(() => listHeight(entries(), props.vars));
  const bodyH = createMemo(() =>
    isExpanded() ? listH() : Math.min(listH(), props.vars.windowH)
  );

  const totalH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return props.vars.rowH + chromeY(props.vars);
    return planMeasure(props.data, ctx, props.vars);
  });

  const autoScroll = () => !!props.data.streaming;

  return (
    <div
      class="border-chat-border rounded-lg border overflow-hidden"
      style={{ height: `${totalH()}px`, 'box-sizing': 'border-box' }}
    >
      <PlanHeader item={props.data} expanded={isExpanded()} rowH={props.vars.rowH} />
      {/* Body wrapper carries the horizontal padding so content is not flush with the card border. */}
      <div
        style={{ 'padding-left': `${props.vars.padX}px`, 'padding-right': `${props.vars.padX}px` }}
      >
        <Show
          when={!isExpanded()}
          fallback={
            // Expanded: full untruncated list
            <PlanList
              entries={entries()}
              padY={props.vars.padY}
              entryGap={props.vars.entryGap}
              iconBox={props.vars.iconBox}
              iconGap={props.vars.iconGap}
            />
          }
        >
          {/* Collapsed: wrap the same list in a capped preview window */}
          <PreviewWindow
            height={bodyH()}
            maxH={props.vars.windowH}
            overlay="fade-bottom"
            autoScrollBottom={autoScroll()}
            contentHeight={() => listH()}
          >
            <PlanList
              entries={entries()}
              padY={props.vars.padY}
              entryGap={props.vars.entryGap}
              iconBox={props.vars.iconBox}
              iconGap={props.vars.iconGap}
            />
          </PreviewWindow>
        </Show>
      </div>
    </div>
  );
}

export const planUnitDef = defineUnit<ChatPlan, PlanVars>({
  kind: 'plan',
  vars: PLAN_VARS,

  estimate(item, ctx, vars): number {
    const headerH = vars.rowH;
    const isExpanded = ctx.expanded(item.id);
    const lineH = ctx.theme.fonts.body.lineHeight;
    const entryH = 2 * lineH;
    const gaps = item.entries.length > 1 ? (item.entries.length - 1) * vars.entryGap : 0;
    const listH = item.entries.length * entryH + gaps + 2 * vars.padY;
    const bodyH = isExpanded ? listH : Math.min(listH, vars.windowH);
    return headerH + bodyH + chromeY(vars);
  },

  measure: planMeasure,

  Render: PlanUnitRender,
});
