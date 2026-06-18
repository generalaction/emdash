/**
 * fileOpDef — ComponentDef for ChatFileOpToolCall rows.
 *
 * estimate / measure: both call the inline height formula (pure arithmetic).
 * Render: FileOperation component.
 *
 * Collapse semantics are inverted: stored "collapsed" bool means "expanded"
 * (same convention as thinking rows). Default absent/false → not expanded.
 *
 * The Render wrapper is minimal; FileOperation.tsx owns its own geometry
 * via useTheme() for full projection.
 */

import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { ChatFileOpToolCall } from '../../model';
import { FileOperation } from './FileOperation';

/** Header row height (body lineHeight + 8px vertical padding). Computed in measure. */
const FILEOP_PAD_Y = 6;
/** Windowed preview height when not expanded (px). */
const FILEOP_WINDOW_H = 72;

export type FileOpLayout = { kind: 'file-op' };

function FileOpRender(props: {
  item: ChatFileOpToolCall;
  layout: Measured<FileOpLayout>;
  ctx: RenderCtx;
}) {
  return (
    <FileOperation item={props.item} collapsed={props.ctx.viewState.isCollapsed(props.item.id)} />
  );
}

/** Pure height formula, mirrors the old measureFileOp. */
function computeFileOpH(
  item: ChatFileOpToolCall,
  isExpanded: (id: string) => boolean,
  ctx: MeasureCtx
): number {
  const bodyLH = ctx.theme.fonts.body.lineHeight;
  const fileopRowH = bodyLH + 8;
  const fileopLineH = bodyLH;

  if (item.ops.length <= 1) return fileopRowH;

  if (isExpanded(item.id)) {
    return fileopRowH + item.ops.length * fileopLineH + 2 * FILEOP_PAD_Y;
  }

  if (item.status === 'running') return fileopRowH + FILEOP_WINDOW_H;

  return fileopRowH;
}

export const fileOpDef = defineComponent<ChatFileOpToolCall, FileOpLayout>({
  kind: 'file-op',

  collapse: { mode: 'inverted', default: false },

  estimate(item, ctx: MeasureCtx): number {
    return computeFileOpH(item, (id) => ctx.expanded(id), ctx);
  },

  measure(item, ctx: MeasureCtx): Measured<FileOpLayout> {
    return {
      height: computeFileOpH(item, (id) => ctx.expanded(id), ctx),
      width: ctx.width,
      layout: { kind: 'file-op' },
    };
  },

  Render: FileOpRender,
});
