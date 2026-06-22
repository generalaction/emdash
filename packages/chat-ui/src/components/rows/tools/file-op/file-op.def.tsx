import { PreviewWindow } from '@components/primitives/PreviewWindow';
import type { MeasureCtx, RenderCtx } from '@core/define';
import { DEFAULT_THEME } from '@core/theme';
import { defineUnit } from '@core/units';
import { pxTokens } from '@styles/px-tokens';
import { assignInlineVars } from '@vanilla-extract/dynamic';
import { Show, createMemo } from 'solid-js';
import type { ChatFileOpToolCall } from '@/model';
import { FileOpRow, FileOpHeader, FileOpList, FileOpPreviewBody } from './FileOperation';
import { fileOpCardVars, fileOpRoot, type FileOpStyleVars } from './file-op.css';

export type FileOpVars = {
  /** Measure-only: fixed row height for header and per-file lines. */
  rowH: number;
  /** Style-relevant: vertical padding inside the file list. Consumed by fileOpCardVars. */
  padY: number;
  /** Measure-only: scrollable preview window height while running. */
  windowH: number;
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

function FileOpUnitRender(props: { data: ChatFileOpToolCall; ctx: RenderCtx; vars: FileOpVars }) {
  const rowH = () => props.vars.rowH;
  const padY = () => props.vars.padY;
  const windowH = () => props.vars.windowH;

  // Inverted semantics: stored "collapsed" bool = "expanded".
  const isExpanded = () => props.ctx.viewState.isCollapsed(props.data.id);

  const totalH = createMemo(() => {
    const item = props.data;
    const v = props.vars;
    if (item.ops.length <= 1) return v.rowH;
    if (isExpanded()) return v.rowH + item.ops.length * v.rowH + 2 * v.padY;
    if (item.status === 'running') return v.rowH + v.windowH;
    return v.rowH;
  });

  const styleVars = (): FileOpStyleVars => ({ height: totalH(), padY: props.vars.padY });

  return (
    <div class={fileOpRoot} style={assignInlineVars(fileOpCardVars, pxTokens(styleVars()))}>
      <Show
        when={props.data.ops.length > 1}
        fallback={<FileOpRow item={props.data} rowH={rowH()} lineH={rowH()} />}
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
  margin: { top: 2, bottom: 2 },
  vars: {
    rowH: DEFAULT_THEME.density.rowH,
    padY: 6,
    windowH: 72,
  },

  estimate(item, ctx, vars): number {
    return measureFileOpH(item, ctx, vars);
  },

  measure(item, ctx, vars): number {
    return measureFileOpH(item, ctx, vars);
  },

  Render: FileOpUnitRender,
});
