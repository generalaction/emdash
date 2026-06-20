/**
 * fileOpUnitDef — native UnitDef for ChatFileOpToolCall rows.
 *
 * Single self-contained unit: measure returns a total height (number),
 * and Render lays out the file-op components directly.
 *
 * Collapse semantics are inverted: stored "collapsed" bool means "expanded".
 *   single file:              FileOpRow (fixed ROW_H)
 *   multi, expanded:          FileOpHeader + FileOpList
 *   multi, collapsed+running: FileOpHeader + PreviewWindow
 *   multi, collapsed+settled: FileOpHeader only
 *
 * Geometry constants are declared in `vars`. The old `file-op-metrics.ts`
 * has been deleted; its values now live in `fileOpUnitDef.vars`.
 */

import { Show, createMemo } from 'solid-js';
import type { MeasureCtx, RenderCtx } from '../../core/define';
import { ROW_H } from '../../core/metrics';
import { defineUnit } from '../../core/units';
import type { ChatFileOpToolCall } from '../../model';
import { PreviewWindow } from '../primitives/PreviewWindow';
import { FileOpRow, FileOpHeader, FileOpList, FileOpPreviewBody } from './FileOperation';

// ── vars type ─────────────────────────────────────────────────────────────────

export type FileOpVars = {
  /** Fixed height (px) of each row (header and per-file lines). */
  rowH: number;
  /** Vertical padding (px) inside the expanded/preview file list. */
  padY: number;
  /** Fixed height (px) of the scrollable preview window while running. */
  windowH: number;
};

const FILEOP_VARS: FileOpVars = {
  rowH: ROW_H,
  padY: 6,
  windowH: 72,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function measureFileOpH(item: ChatFileOpToolCall, ctx: MeasureCtx, vars: FileOpVars): number {
  const { rowH, padY, windowH } = vars;
  const isExpanded = ctx.expanded(item.id);

  if (item.ops.length <= 1) return rowH;
  if (isExpanded) return rowH + item.ops.length * rowH + 2 * padY;
  if (item.status === 'running') return rowH + windowH;
  return rowH;
}

// ── Render ────────────────────────────────────────────────────────────────────

function FileOpUnitRender(props: { data: ChatFileOpToolCall; ctx: RenderCtx; vars?: FileOpVars }) {
  const vars = () => props.vars ?? FILEOP_VARS;
  const rowH = () => vars().rowH;
  const padY = () => vars().padY;
  const windowH = () => vars().windowH;

  // Inverted semantics: stored "collapsed" bool = "expanded".
  const isExpanded = () => props.ctx.viewState.isCollapsed(props.data.id);

  const totalH = createMemo(() => {
    const item = props.data;
    const v = vars();
    if (item.ops.length <= 1) return v.rowH;
    if (isExpanded()) return v.rowH + item.ops.length * v.rowH + 2 * v.padY;
    if (item.status === 'running') return v.rowH + v.windowH;
    return v.rowH;
  });

  return (
    <div style={{ height: `${totalH()}px` }}>
      <Show
        when={props.data.ops.length > 1}
        fallback={
          // Single-file row
          <FileOpRow item={props.data} rowH={rowH()} lineH={rowH()} />
        }
      >
        <FileOpHeader item={props.data} expanded={isExpanded()} rowH={rowH()} />
        <Show when={isExpanded()}>
          <FileOpList item={props.data} lineH={rowH()} padY={padY()} />
        </Show>
        <Show when={!isExpanded() && props.data.status === 'running'}>
          <PreviewWindow
            height={windowH()}
            maxH={windowH()}
            overlay="fade-top"
            autoScrollBottom
            contentHeight={() => props.data.ops.length}
          >
            <FileOpPreviewBody item={props.data} lineH={rowH()} padY={padY()} />
          </PreviewWindow>
        </Show>
      </Show>
    </div>
  );
}

// ── UnitDef ───────────────────────────────────────────────────────────────────

export const fileOpUnitDef = defineUnit<ChatFileOpToolCall, FileOpVars>({
  kind: 'file-op',
  vars: FILEOP_VARS,

  estimate(item, ctx, vars): number {
    return measureFileOpH(item, ctx, vars);
  },

  measure(item, ctx, vars): number {
    return measureFileOpH(item, ctx, vars);
  },

  Render: FileOpUnitRender,
});
