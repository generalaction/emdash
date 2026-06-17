/**
 * measureDiff — height computation for ChatDiff rows.
 *
 * Returns `DiffMeasureResult`, which spec.tsx passes directly to the Render
 * component so it can consume the pre-computed window without re-running
 * the diff algorithm (same pattern as thinkingRow's body BlocksLayout).
 *
 * Height formula (content-only; Row.tsx adds the per-kind wrapper padding):
 *   DIFF_HEADER_H + preview.length * codeLineHeight + 2 * DIFF_BORDER
 *
 * `estimate` returns the maximum possible height (12 lines) so the virtualizer
 * always reserves enough space; `measure` returns the exact height.
 */

import type { FontConfig } from '../../core/measure/fonts';
import type { ChatDiff } from '../../model';
import { computeDiff, countChanges, selectPreview, type DiffRow } from './diff-lines';
import { langFromPath } from './lang';
import { DIFF_BORDER, DIFF_CONTEXT, DIFF_HEADER_H, DIFF_MAX_LINES } from './metrics';

export type DiffMeasureResult = {
  height: number;
  /** Windowed rows to render (≤ DIFF_MAX_LINES). Empty when no changes. */
  previewRows: DiffRow[];
  adds: number;
  dels: number;
  /** Canonical language string for the highlighter (may be undefined). */
  lang: string | undefined;
  /** True when the preview window omits diff content below the last row. */
  truncated: boolean;
};

/** Cheap upper-bound estimate — always reserves DIFF_MAX_LINES. */
export function estimateDiff(fonts: FontConfig): number {
  return DIFF_HEADER_H + DIFF_MAX_LINES * fonts.code.lineHeight + 2 * DIFF_BORDER;
}

/** Exact measure — runs computeDiff + selectPreview. */
export function measureDiff(item: ChatDiff, fonts: FontConfig): DiffMeasureResult {
  const rows = computeDiff(item.oldText, item.newText);
  const { adds, dels } = countChanges(rows);
  const previewRows = selectPreview(rows, DIFF_MAX_LINES, DIFF_CONTEXT);
  const lang = langFromPath(item.path);

  // slice() preserves element identity, so the window omits trailing content
  // whenever its last row is not the last row of the full diff.
  const truncated = previewRows.length > 0 && previewRows.at(-1) !== rows.at(-1);

  const height =
    previewRows.length === 0
      ? DIFF_HEADER_H + 2 * DIFF_BORDER
      : DIFF_HEADER_H + previewRows.length * fonts.code.lineHeight + 2 * DIFF_BORDER;

  return { height, previewRows, adds, dels, lang, truncated };
}
