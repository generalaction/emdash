/**
 * planDef — ComponentDef for ChatPlan rows.
 *
 * Renders a bordered, collapsible agent task list (collapsed by default).
 *
 * Layout tree (inside a bordered, padded card):
 *   expanded:   collapsible({ header, expanded:true, body:slot('plan:list', listH) })
 *   collapsed:  stack([ slot('plan:header'), scrollWindow(slot('plan:list', listH), PLAN_WINDOW_H) ])
 *
 * Collapsed always shows a capped preview window (max PLAN_WINDOW_H); while the
 * plan is `streaming` the window auto-scrolls to the newest task. Clicking the
 * header expands to the full untruncated list.
 *
 * Each entry's `content` is measured as wrapped markdown text via
 * layoutBlockStack + caches.parseBlocks, reusing the same per-block memo
 * (blockMemo WeakMap) used by message rows.
 *
 * Collapse semantics use inverted mode (same as thinking/file-op): the stored
 * "collapsed" view-state flag actually means "expanded", so the plan starts
 * collapsed (no flag) and expands on click.
 *
 * The card border + padding are applied by PlanRender's outer div with
 * box-sizing:border-box; the chrome height (2*PLAN_OUTER_PAD_Y + 2*PLAN_BORDER)
 * is added to the measured total so the virtualizer reserves the right space.
 */

import type { Component } from 'solid-js';
import { SLOT_NAMES, collapsible, scrollWindow, slot, stack } from '../../core/compose';
import type { StackLayout } from '../../core/compose';
import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import { layoutBlockStack } from '../../core/layout/block-stack';
import { HEADER_ROW_EXTRA_H } from '../../core/metrics';
import type { ChatPlan, PlanEntryPriority, PlanEntryStatus } from '../../model';
import { Project } from '../Project';
import { useTheme } from '../ThemeContext';
import {
  PLAN_BORDER,
  PLAN_ENTRY_GAP,
  PLAN_ENTRY_INDENT,
  PLAN_OUTER_PAD_Y,
  PLAN_PAD_X,
  PLAN_PAD_Y,
  PLAN_WINDOW_H,
} from './plan-metrics';
import { PlanHeader, PlanList } from './Plan';

export {
  PLAN_BORDER,
  PLAN_ENTRY_GAP,
  PLAN_ENTRY_INDENT,
  PLAN_OUTER_PAD_Y,
  PLAN_PAD_X,
  PLAN_PAD_Y,
  PLAN_WINDOW_H,
};

/** Total horizontal + vertical chrome added by the card border + outer padding. */
const CHROME_Y = 2 * PLAN_OUTER_PAD_Y + 2 * PLAN_BORDER;
const CHROME_X = 2 * PLAN_PAD_X + 2 * PLAN_BORDER;

// ── Layout type ───────────────────────────────────────────────────────────────

export type PlanEntryLaid = {
  /** Pre-measured block stack for this entry's content. */
  measured: Measured<StackLayout>;
  status: PlanEntryStatus;
  priority: PlanEntryPriority;
};

export type PlanNodeLayout = {
  kind: 'plan';
  /**
   * Branch-specific compose subtree produced by measure().
   * Project walks this in PlanRender.
   */
  // oxlint-disable-next-line typescript/no-explicit-any -- compose tree; varies by state
  tree: Measured<any>;
  /**
   * Per-entry measured results. Always populated (both collapsed preview and
   * expanded list render them). PlanList reads these to render each entry at
   * its exact measured height.
   */
  entries: PlanEntryLaid[];
};

// ── Render ────────────────────────────────────────────────────────────────────

function PlanRender(props: {
  item: ChatPlan;
  layout: Measured<PlanNodeLayout>;
  ctx: RenderCtx;
}) {
  const theme = useTheme();
  const rowH = () => theme().fonts.body.lineHeight + HEADER_ROW_EXTRA_H;
  // Inverted collapse mode: stored "collapsed" flag means "expanded".
  const expanded = () => props.ctx.viewState.isCollapsed(props.item.id);

  return (
    <div
      class="rounded-lg border border-border"
      style={{
        height: `${props.layout.height}px`,
        'box-sizing': 'border-box',
        'padding-top': `${PLAN_OUTER_PAD_Y}px`,
        'padding-bottom': `${PLAN_OUTER_PAD_Y}px`,
        'padding-left': `${PLAN_PAD_X}px`,
        'padding-right': `${PLAN_PAD_X}px`,
      }}
    >
      <Project
        node={props.layout.layout.tree}
        slots={{
          [SLOT_NAMES.PLAN_HEADER]: () => (
            <PlanHeader item={props.item} expanded={expanded()} rowH={rowH()} />
          ),
          [SLOT_NAMES.PLAN_LIST]: () => (
            <PlanList
              entries={props.layout.layout.entries}
              padY={PLAN_PAD_Y}
              entryGap={PLAN_ENTRY_GAP}
              indent={PLAN_ENTRY_INDENT}
            />
          ),
        }}
      />
    </div>
  );
}

// ── ComponentDef ──────────────────────────────────────────────────────────────

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

export const planDef = defineComponent<ChatPlan, PlanNodeLayout>({
  kind: 'plan',

  // Inverted mode: ctx.expanded(id) = isCollapsed(id) (stored flag means "expanded").
  // Default false → plan starts collapsed (capped preview), expands on click.
  collapse: { mode: 'inverted', default: false },

  estimate(item, ctx: MeasureCtx): number {
    const headerH = ctx.theme.fonts.body.lineHeight + HEADER_ROW_EXTRA_H;
    const isExpanded = ctx.expanded(item.id);
    // ~2 wrapped lines per entry as a heuristic for off-screen rows.
    const lineH = ctx.theme.fonts.body.lineHeight;
    const entryH = 2 * lineH;
    const gaps = item.entries.length > 1 ? (item.entries.length - 1) * PLAN_ENTRY_GAP : 0;
    const listH = item.entries.length * entryH + gaps + 2 * PLAN_PAD_Y;
    const bodyH = isExpanded ? listH : Math.min(listH, PLAN_WINDOW_H);
    return headerH + bodyH + CHROME_Y;
  },

  measure(item, ctx: MeasureCtx): Measured<PlanNodeLayout> {
    const headerH = ctx.theme.fonts.body.lineHeight + HEADER_ROW_EXTRA_H;
    const isExpanded = ctx.expanded(item.id);
    const headerSlot = SLOT_NAMES.PLAN_HEADER;

    const entries = measureEntries(item, ctx);
    const listH = listHeight(entries);

    // ── Expanded: full untruncated list ───────────────────────────────────────
    if (isExpanded) {
      const body = slot(SLOT_NAMES.PLAN_LIST, listH);
      const tree = collapsible({ headerH, headerSlot, expanded: true, body });
      return {
        height: tree.height + CHROME_Y,
        width: ctx.width,
        layout: { kind: 'plan', tree, entries },
      };
    }

    // ── Collapsed: header + capped preview window ──────────────────────────────
    const preview = scrollWindow(slot(SLOT_NAMES.PLAN_LIST, listH), PLAN_WINDOW_H, {
      overlay: 'fade-top',
      autoScrollBottom: !!item.streaming,
    });
    const tree = stack(
      [
        { id: `${item.id}:header`, measured: slot(headerSlot, headerH) },
        { id: `${item.id}:preview`, measured: preview },
      ],
      { gap: 0 }
    );
    return {
      height: tree.height + CHROME_Y,
      width: ctx.width,
      layout: { kind: 'plan', tree, entries },
    };
  },

  Render: PlanRender as Component<{
    item: ChatPlan;
    layout: Measured<PlanNodeLayout>;
    ctx: RenderCtx;
  }>,
});
