/**
 * diffDef — ComponentDef for ChatDiff rows.
 *
 * estimate: cheap constant upper-bound (diffMaxLines from theme geometry).
 * measure:  exact — runs computeDiff + selectPreview; returns DiffMeasureResult
 *           wrapped in Measured so the Render component can consume the
 *           pre-computed preview window without re-running the diff algorithm.
 *
 * Layout wraps the Diff component in a sized container and horizontal padding.
 */

import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { ChatDiff } from '../../model';
import { useTheme } from '../ThemeContext';
import { Diff } from './Diff';
import { computeDiff, countChanges, selectPreview, type DiffRow } from './diff-lines';
import { langFromPath } from './lang';

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
  const g = () => theme().geometry;

  return (
    <div
      style={{
        height: `${props.layout.height}px`,
        'padding-inline': `${g().rowInsetX}px`,
      }}
    >
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
    const { diffHeaderH, diffMaxLines, diffBorder } = ctx.theme.geometry;
    return diffHeaderH + diffMaxLines * ctx.theme.fonts.code.lineHeight + 2 * diffBorder;
  },

  measure(item, ctx: MeasureCtx): Measured<DiffLayout> {
    const { diffHeaderH, diffMaxLines, diffContext, diffBorder } = ctx.theme.geometry;
    const codeLineH = ctx.theme.fonts.code.lineHeight;

    const rows = computeDiff(item.oldText, item.newText);
    const { adds, dels } = countChanges(rows);
    const previewRows = selectPreview(rows, diffMaxLines, diffContext);
    const lang = langFromPath(item.path);
    const truncated = previewRows.length > 0 && previewRows.at(-1) !== rows.at(-1);

    const height =
      previewRows.length === 0
        ? diffHeaderH + 2 * diffBorder
        : diffHeaderH + previewRows.length * codeLineH + 2 * diffBorder;

    return {
      height,
      width: ctx.width,
      layout: { kind: 'diff', previewRows, adds, dels, lang, truncated },
    };
  },

  Render: DiffRender,
});
