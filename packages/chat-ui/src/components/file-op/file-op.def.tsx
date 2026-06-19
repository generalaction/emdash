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
 */

import { Show, createMemo } from 'solid-js';
import type { MeasureCtx, RenderCtx } from '../../core/define';
import { ROW_H } from '../../core/metrics';
import { defineUnit } from '../../core/units';
import type { ChatFileOpToolCall } from '../../model';
import { PreviewWindow } from '../primitives/PreviewWindow';
import { FILEOP_PAD_Y, FILEOP_WINDOW_H } from './file-op-metrics';
import { FileOpRow, FileOpHeader, FileOpList, FileOpPreviewBody } from './FileOperation';

export { FILEOP_PAD_Y, FILEOP_WINDOW_H };

function measureFileOpH(item: ChatFileOpToolCall, ctx: MeasureCtx): number {
  const rowH = ROW_H;
  const lineH = ROW_H;
  const isExpanded = ctx.expanded(item.id);

  if (item.ops.length <= 1) return rowH;
  if (isExpanded) return rowH + item.ops.length * lineH + 2 * FILEOP_PAD_Y;
  if (item.status === 'running') return rowH + FILEOP_WINDOW_H;
  return rowH;
}

function FileOpUnitRender(props: { data: ChatFileOpToolCall; ctx: RenderCtx }) {
  const rowH = ROW_H;
  const lineH = ROW_H;
  // Inverted semantics: stored "collapsed" bool = "expanded".
  const isExpanded = () => props.ctx.viewState.isCollapsed(props.data.id);

  const totalH = createMemo(() => {
    const item = props.data;
    if (item.ops.length <= 1) return rowH;
    if (isExpanded()) return rowH + item.ops.length * lineH + 2 * FILEOP_PAD_Y;
    if (item.status === 'running') return rowH + FILEOP_WINDOW_H;
    return rowH;
  });

  return (
    <div style={{ height: `${totalH()}px` }}>
      <Show
        when={props.data.ops.length > 1}
        fallback={
          // Single-file row
          <FileOpRow item={props.data} rowH={rowH} lineH={lineH} />
        }
      >
        <FileOpHeader item={props.data} expanded={isExpanded()} rowH={rowH} />
        <Show when={isExpanded()}>
          <FileOpList item={props.data} lineH={lineH} padY={FILEOP_PAD_Y} />
        </Show>
        <Show when={!isExpanded() && props.data.status === 'running'}>
          <PreviewWindow
            height={FILEOP_WINDOW_H}
            maxH={FILEOP_WINDOW_H}
            overlay="fade-top"
            autoScrollBottom
            contentHeight={() => props.data.ops.length}
          >
            <FileOpPreviewBody item={props.data} lineH={lineH} padY={FILEOP_PAD_Y} />
          </PreviewWindow>
        </Show>
      </Show>
    </div>
  );
}

export const fileOpUnitDef = defineUnit<ChatFileOpToolCall>({
  kind: 'file-op',

  estimate(item, ctx): number {
    return measureFileOpH(item, ctx);
  },

  measure(item, ctx): number {
    return measureFileOpH(item, ctx);
  },

  Render: FileOpUnitRender,
});
