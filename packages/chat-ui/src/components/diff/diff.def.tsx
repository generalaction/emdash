/**
 * diffDef — ComponentDef for ChatDiff rows.
 *
 * measure: builds a compose Measured tree and stores it alongside DiffLayout
 *          data in the layout payload.
 *
 *   tree = stack([
 *     slot('diff:header', DIFF_HEADER_H),
 *     scrollWindow(slot('diff:body', bodyH), maxH, { overlay: 'fade-bottom'? })
 *   ])
 *
 * DiffRender provides 'diff:header' (DiffHeader) and 'diff:body' (DiffLines)
 * slots, then delegates to Project.
 */

import { slot, scrollWindow, stack } from '../../core/compose';
import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { ChatDiff } from '../../model';
import { Project } from '../Project';
import { useTheme } from '../ThemeContext';
import { DiffHeader, DiffLines } from './Diff';
import { countChanges, selectPreview, type DiffRow } from './diff-lines';
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

export type DiffNodeLayout = {
  kind: 'diff';
  /**
   * Compose subtree (stack of header slot + windowed body slot).
   * Project walks this in DiffRender.
   */
  // oxlint-disable-next-line typescript/no-explicit-any -- compose tree
  tree: Measured<any>;
  /** Computed diff content for rendering in the 'diff:header' and 'diff:body' slots. */
  data: DiffLayout;
};

function DiffRender(props: { item: ChatDiff; layout: Measured<DiffNodeLayout>; ctx: RenderCtx }) {
  const theme = useTheme();
  const data = () => props.layout.layout.data;

  return (
    <div style={{ height: `${props.layout.height}px` }}>
      <Project
        node={props.layout.layout.tree}
        slots={{
          'diff:header': () => (
            <DiffHeader
              item={props.item}
              adds={data().adds}
              dels={data().dels}
              headerH={DIFF_HEADER_H}
            />
          ),
          'diff:body': () => (
            <DiffLines
              item={props.item}
              layout={data()}
              codeLineHeight={() => theme().fonts.code.lineHeight}
            />
          ),
        }}
      />
    </div>
  );
}

export const diffDef = defineComponent<ChatDiff, DiffNodeLayout>({
  kind: 'diff',

  estimate(_item, ctx: MeasureCtx): number {
    return DIFF_HEADER_H + DIFF_MAX_LINES * ctx.theme.fonts.code.lineHeight + 2 * DIFF_BORDER;
  },

  measure(item, ctx: MeasureCtx): Measured<DiffNodeLayout> {
    const codeLineH = ctx.theme.fonts.code.lineHeight;

    const rows = ctx.caches.computeDiff(item.oldText, item.newText);
    const { adds, dels } = countChanges(rows);
    const previewRows = selectPreview(rows, DIFF_MAX_LINES, DIFF_CONTEXT);
    const lang = langFromPath(item.path);
    const truncated = previewRows.length > 0 && previewRows.at(-1) !== rows.at(-1);

    const bodyH =
      previewRows.length === 0 ? 2 * DIFF_BORDER : previewRows.length * codeLineH + 2 * DIFF_BORDER;

    const maxH = bodyH;
    const data: DiffLayout = { kind: 'diff', previewRows, adds, dels, lang, truncated };

    const bodySlot = slot('diff:body', bodyH);
    const windowedBody = scrollWindow(bodySlot, maxH, {
      overlay: truncated ? 'fade-bottom' : undefined,
    });

    const tree = stack(
      [
        { id: `${item.id}:header`, measured: slot('diff:header', DIFF_HEADER_H) },
        { id: `${item.id}:body`, measured: windowedBody },
      ],
      { gap: 0 }
    );

    return {
      height: tree.height,
      width: ctx.width,
      layout: { kind: 'diff', tree, data },
    };
  },

  Render: DiffRender,
});
