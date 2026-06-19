/**
 * diffUnitDef — native UnitDef for ChatDiff rows.
 *
 * Single self-contained unit: measure returns a total height (number),
 * and Render computes the DiffLayout from measureCtx and renders
 * DiffHeader + DiffLines directly.
 */

import { Show, createMemo } from 'solid-js';
import type { MeasureCtx, RenderCtx } from '../../core/define';
import { defineUnit } from '../../core/units';
import type { ChatDiff } from '../../model';
import { DiffHeader, DiffLines } from './Diff';
import { countChanges, selectPreview, type DiffRow } from './diff-lines';
import { langFromPath } from './lang';

/** Header row height (px). */
const DIFF_HEADER_H = 32;
/** Maximum diff lines to include in the preview window. */
const DIFF_MAX_LINES = 8;
/** Lines of unchanged context shown around each change hunk. */
const DIFF_CONTEXT = 1;
/** Border width (px) on each side of the diff block. */
const DIFF_BORDER = 1;

export type DiffLayout = {
  kind: 'diff';
  previewRows: DiffRow[];
  adds: number;
  dels: number;
  lang: string | undefined;
  truncated: boolean;
};

function diffMeasure(item: ChatDiff, ctx: MeasureCtx): number {
  if (item.status === 'running' && item.newText.length === 0) return DIFF_HEADER_H;
  const codeLineH = ctx.theme.fonts.code.lineHeight;
  const rows = ctx.caches.computeDiff(item.oldText, item.newText);
  const previewRows = selectPreview(rows, DIFF_MAX_LINES, DIFF_CONTEXT);
  const bodyH =
    previewRows.length === 0 ? 2 * DIFF_BORDER : previewRows.length * codeLineH + 2 * DIFF_BORDER;
  return DIFF_HEADER_H + bodyH;
}

function DiffUnitRender(props: { data: ChatDiff; ctx: RenderCtx }) {
  const mCtx = () => props.ctx.measureCtx?.();

  const layout = createMemo<DiffLayout | null>(() => {
    const ctx = mCtx();
    if (!ctx) return null;
    const rows = ctx.caches.computeDiff(props.data.oldText, props.data.newText);
    const { adds, dels } = countChanges(rows);
    const previewRows = selectPreview(rows, DIFF_MAX_LINES, DIFF_CONTEXT);
    const lang = langFromPath(props.data.path);
    const truncated = previewRows.length > 0 && previewRows.at(-1) !== rows.at(-1);
    return { kind: 'diff', previewRows, adds, dels, lang, truncated };
  });

  const totalH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return DIFF_HEADER_H;
    return diffMeasure(props.data, ctx);
  });

  const headerOnly = () => props.data.status === 'running' && props.data.newText.length === 0;
  const codeLineH = () => mCtx()?.theme.fonts.code.lineHeight ?? 0;

  return (
    <div style={{ height: `${totalH()}px` }}>
      <Show when={layout()}>
        {(l) => (
          <>
            <DiffHeader
              item={props.data}
              adds={l().adds}
              dels={l().dels}
              headerH={DIFF_HEADER_H}
              hasBody={!headerOnly()}
            />
            <Show when={!headerOnly()}>
              <DiffLines item={props.data} layout={l()} codeLineHeight={codeLineH} />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

export const diffUnitDef = defineUnit<ChatDiff>({
  kind: 'diff',

  estimate(item, ctx): number {
    if (item.status === 'running' && item.newText.length === 0) return DIFF_HEADER_H;
    return DIFF_HEADER_H + DIFF_MAX_LINES * ctx.theme.fonts.code.lineHeight + 2 * DIFF_BORDER;
  },

  measure: diffMeasure,

  Render: DiffUnitRender,
});
