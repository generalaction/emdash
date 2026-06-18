/**
 * diffDef — ComponentDef for ChatDiff rows.
 *
 * estimate: cheap constant upper-bound (max preview lines).
 * measure:  exact — runs computeDiff + selectPreview; returns DiffMeasureResult
 *           wrapped in Measured so the Render component can consume the
 *           pre-computed preview window without re-running the diff algorithm.
 */

import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { ChatDiff } from '../../model';
import { useTheme } from '../ThemeContext';
import { Diff } from './Diff';
import { computeDiff, countChanges, selectPreview, type DiffRow } from './diff-lines';
import { langFromPath } from './lang';

/** Header row height (px). */
const DIFF_HEADER_H = 28;
/** Maximum diff lines to include in the preview window. */
const DIFF_MAX_LINES = 12;
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

function DiffRender(props: { item: ChatDiff; layout: Measured<DiffLayout>; ctx: RenderCtx }) {
  const theme = useTheme();

  return (
    <div style={{ height: `${props.layout.height}px` }}>
      <Diff
        item={props.item}
        layout={props.layout.layout}
        codeLineHeight={() => theme().fonts.code.lineHeight}
      />
    </div>
  );
}

export const diffDef = defineComponent<ChatDiff, DiffLayout>({
  kind: 'diff',

  estimate(_item, ctx: MeasureCtx): number {
    return DIFF_HEADER_H + DIFF_MAX_LINES * ctx.theme.fonts.code.lineHeight + 2 * DIFF_BORDER;
  },

  measure(item, ctx: MeasureCtx): Measured<DiffLayout> {
    const codeLineH = ctx.theme.fonts.code.lineHeight;

    const rows = computeDiff(item.oldText, item.newText);
    const { adds, dels } = countChanges(rows);
    const previewRows = selectPreview(rows, DIFF_MAX_LINES, DIFF_CONTEXT);
    const lang = langFromPath(item.path);
    const truncated = previewRows.length > 0 && previewRows.at(-1) !== rows.at(-1);

    const height =
      previewRows.length === 0
        ? DIFF_HEADER_H + 2 * DIFF_BORDER
        : DIFF_HEADER_H + previewRows.length * codeLineH + 2 * DIFF_BORDER;

    return {
      height,
      width: ctx.width,
      layout: { kind: 'diff', previewRows, adds, dels, lang, truncated },
    };
  },

  Render: DiffRender,
});
