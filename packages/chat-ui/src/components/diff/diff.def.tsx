/**
 * diffUnitDef — native UnitDef for ChatDiff rows.
 *
 * Single self-contained unit: measure returns a total height (number),
 * and Render computes the DiffLayout from measureCtx and renders
 * DiffHeader + DiffLines directly.
 *
 * Geometry constants are declared in `vars` so measure and Render share
 * a single source of truth. The old `diff/measure.ts` (which had diverged
 * constants) has been removed; `diff/measure.test.ts` is now repointed here.
 */

import { Show, createMemo } from 'solid-js';
import type { MeasureCtx, RenderCtx } from '../../core/define';
import { defineUnit } from '../../core/units';
import type { ChatDiff } from '../../model';
import { DiffHeader, DiffLines } from './Diff';
import { countChanges, selectPreview, type DiffRow } from './diff-lines';
import { langFromPath } from './lang';

// ── vars type ─────────────────────────────────────────────────────────────────

export type DiffVars = {
  /** Header row height (px). */
  headerH: number;
  /** Maximum diff lines to include in the preview window. */
  maxLines: number;
  /** Lines of unchanged context shown around each change hunk. */
  context: number;
  /** Border width (px) on each side of the diff block. */
  border: number;
};

const DIFF_VARS: DiffVars = {
  headerH: 32,
  maxLines: 8,
  context: 1,
  border: 1,
};

export type DiffLayout = {
  kind: 'diff';
  previewRows: DiffRow[];
  adds: number;
  dels: number;
  lang: string | undefined;
  truncated: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function diffBodyH(previewRows: DiffRow[], codeLineH: number, border: number): number {
  return previewRows.length === 0
    ? 2 * border
    : previewRows.length * codeLineH + 2 * border;
}

function diffUnitH(item: ChatDiff, ctx: MeasureCtx, vars: DiffVars): number {
  if (item.status === 'running' && item.newText.length === 0) return vars.headerH;
  const codeLineH = ctx.theme.fonts.code.lineHeight;
  const rows = ctx.caches.computeDiff(item.oldText, item.newText);
  const previewRows = selectPreview(rows, vars.maxLines, vars.context);
  return vars.headerH + diffBodyH(previewRows, codeLineH, vars.border);
}

// ── Render ────────────────────────────────────────────────────────────────────

function DiffUnitRender(props: { data: ChatDiff; ctx: RenderCtx; vars?: DiffVars }) {
  const vars = () => props.vars ?? DIFF_VARS;
  const mCtx = () => props.ctx.measureCtx?.();

  const layout = createMemo<DiffLayout | null>(() => {
    const ctx = mCtx();
    if (!ctx) return null;
    const rows = ctx.caches.computeDiff(props.data.oldText, props.data.newText);
    const { adds, dels } = countChanges(rows);
    const { maxLines, context } = vars();
    const previewRows = selectPreview(rows, maxLines, context);
    const lang = langFromPath(props.data.path);
    const truncated = previewRows.length > 0 && previewRows.at(-1) !== rows.at(-1);
    return { kind: 'diff', previewRows, adds, dels, lang, truncated };
  });

  const totalH = createMemo(() => {
    const ctx = mCtx();
    if (!ctx) return vars().headerH;
    return diffUnitH(props.data, ctx, vars());
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
              headerH={vars().headerH}
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

// ── UnitDef ───────────────────────────────────────────────────────────────────

export const diffUnitDef = defineUnit<ChatDiff, DiffVars>({
  kind: 'diff',
  vars: DIFF_VARS,

  estimate(item, ctx, vars): number {
    if (item.status === 'running' && item.newText.length === 0) return vars.headerH;
    return vars.headerH + vars.maxLines * ctx.theme.fonts.code.lineHeight + 2 * vars.border;
  },

  measure(item, ctx, vars): number {
    return diffUnitH(item, ctx, vars);
  },

  Render: DiffUnitRender,
});
