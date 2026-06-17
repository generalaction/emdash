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
  const { fileopRowH, fileopLineH, fileopPadY, fileopWindowH } = ctx.theme.geometry;

  if (item.ops.length <= 1) return fileopRowH;

  if (isExpanded(item.id)) {
    return fileopRowH + item.ops.length * fileopLineH + 2 * fileopPadY;
  }

  if (item.status === 'running') return fileopRowH + fileopWindowH;

  return fileopRowH;
}

export const fileOpDef = defineComponent<ChatFileOpToolCall, FileOpLayout>({
  kind: 'file-op',

  estimate(item, ctx: MeasureCtx): number {
    return computeFileOpH(item, ctx.isCollapsed, ctx);
  },

  measure(item, ctx: MeasureCtx): Measured<FileOpLayout> {
    return {
      height: computeFileOpH(item, ctx.isCollapsed, ctx),
      width: ctx.width,
      layout: { kind: 'file-op' },
    };
  },

  Render: FileOpRender,
});
