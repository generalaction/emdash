/**
 * fileOpDef — ComponentDef for ChatFileOpToolCall rows.
 *
 * measure: builds a branch-specific compose Measured tree (single-source of truth
 *          for geometry) and stores it in FileOpNodeLayout.tree.
 *
 *   single file:              slot('file-op:row', rowH)
 *   multi, expanded:          collapsible({ header, expanded:true, body:slot(list) })
 *   multi, collapsed+running: stack([ slot(header), scrollWindow(slot(preview)) ])
 *   multi, collapsed+settled: collapsible({ header, expanded:false })
 *
 * FileOpRender provides slot components and delegates to Project.
 * ProjectWindow (via scrollWindow) replaces the bespoke FileOpPreview auto-scroll.
 *
 * Constants FILEOP_PAD_Y and FILEOP_WINDOW_H are the single source of truth;
 * FileOperation.tsx imports them instead of re-declaring.
 *
 * Collapse semantics are inverted: stored "collapsed" bool means "expanded"
 * (same convention as thinking rows).
 */

import { collapsible, scrollWindow, slot, stack } from '../../core/compose';
import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import { HEADER_ROW_EXTRA_H } from '../../core/metrics';
import type { ChatFileOpToolCall } from '../../model';
import { Project } from '../Project';
import { useTheme } from '../ThemeContext';
import { FILEOP_PAD_Y, FILEOP_WINDOW_H } from './file-op-metrics';
import { FileOpRow, FileOpHeader, FileOpList, FileOpPreviewBody } from './FileOperation';

export { FILEOP_PAD_Y, FILEOP_WINDOW_H };

// ── Layout type ───────────────────────────────────────────────────────────────

export type FileOpNodeLayout = {
  kind: 'file-op';
  /**
   * Branch-specific compose subtree produced by measure().
   * Project walks this in FileOpRender.
   */
  // oxlint-disable-next-line typescript/no-explicit-any -- compose tree; varies by state
  tree: Measured<any>;
};

// ── Render ────────────────────────────────────────────────────────────────────

function FileOpRender(props: {
  item: ChatFileOpToolCall;
  layout: Measured<FileOpNodeLayout>;
  ctx: RenderCtx;
}) {
  const theme = useTheme();
  const rowH = () => theme().fonts.body.lineHeight + HEADER_ROW_EXTRA_H;
  const lineH = () => theme().fonts.body.lineHeight;
  // Inverted: stored "collapsed" bool means "expanded".
  const expanded = () => props.ctx.viewState.isCollapsed(props.item.id);

  return (
    <div style={{ height: `${props.layout.height}px` }}>
      <Project
        node={props.layout.layout.tree}
        slots={{
          'file-op:row': () => <FileOpRow item={props.item} rowH={rowH()} lineH={lineH()} />,
          'file-op:header': () => (
            <FileOpHeader item={props.item} expanded={expanded()} rowH={rowH()} />
          ),
          'file-op:list': () => (
            <FileOpList item={props.item} lineH={lineH()} padY={FILEOP_PAD_Y} />
          ),
          'file-op:preview': () => (
            <FileOpPreviewBody item={props.item} lineH={lineH()} padY={FILEOP_PAD_Y} />
          ),
        }}
      />
    </div>
  );
}

// ── ComponentDef ──────────────────────────────────────────────────────────────

export const fileOpDef = defineComponent<ChatFileOpToolCall, FileOpNodeLayout>({
  kind: 'file-op',

  collapse: { mode: 'inverted', default: false },

  estimate(item, ctx: MeasureCtx): number {
    return measureFileOpH(item, ctx);
  },

  measure(item, ctx: MeasureCtx): Measured<FileOpNodeLayout> {
    const rowH = ctx.theme.fonts.body.lineHeight + HEADER_ROW_EXTRA_H;
    const lineH = ctx.theme.fonts.body.lineHeight;
    const isExpanded = ctx.expanded(item.id);
    const headerSlot = 'file-op:header';

    // ── Single file ───────────────────────────────────────────────────────────
    if (item.ops.length <= 1) {
      const tree = slot('file-op:row', rowH);
      return { height: tree.height, width: ctx.width, layout: { kind: 'file-op', tree } };
    }

    // ── Multi, expanded ───────────────────────────────────────────────────────
    if (isExpanded) {
      const listH = item.ops.length * lineH + 2 * FILEOP_PAD_Y;
      const tree = collapsible({
        headerH: rowH,
        headerSlot,
        expanded: true,
        body: slot('file-op:list', listH),
      });
      return { height: tree.height, width: ctx.width, layout: { kind: 'file-op', tree } };
    }

    // ── Multi, collapsed + running: header + scrollWindow preview ─────────────
    if (item.status === 'running') {
      const preview = scrollWindow(slot('file-op:preview', FILEOP_WINDOW_H), FILEOP_WINDOW_H, {
        overlay: 'fade-top',
        autoScrollBottom: true,
      });
      const tree = stack(
        [
          { id: `${item.id}:header`, measured: slot(headerSlot, rowH) },
          { id: `${item.id}:preview`, measured: preview },
        ],
        { gap: 0 }
      );
      return { height: tree.height, width: ctx.width, layout: { kind: 'file-op', tree } };
    }

    // ── Multi, collapsed + settled: header only ───────────────────────────────
    const tree = collapsible({ headerH: rowH, headerSlot, expanded: false });
    return { height: tree.height, width: ctx.width, layout: { kind: 'file-op', tree } };
  },

  Render: FileOpRender,
});

// ── Internal height formula (estimate mirror) ─────────────────────────────────

function measureFileOpH(item: ChatFileOpToolCall, ctx: MeasureCtx): number {
  const rowH = ctx.theme.fonts.body.lineHeight + HEADER_ROW_EXTRA_H;
  const lineH = ctx.theme.fonts.body.lineHeight;
  const isExpanded = ctx.expanded(item.id);

  if (item.ops.length <= 1) return rowH;

  if (isExpanded) return rowH + item.ops.length * lineH + 2 * FILEOP_PAD_Y;

  if (item.status === 'running') return rowH + FILEOP_WINDOW_H;

  return rowH;
}
