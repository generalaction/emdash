/**
 * measureDiff — height computation for ChatDiff rows.
 *
 * Returns DiffMeasureResult, which the Render component consumes directly so
 * the diff algorithm does not re-run on every render.
 *
 * Height formula (content-only; Row.tsx adds the per-kind wrapper padding):
 *   DIFF_HEADER_H + preview.length * codeLineHeight + 2 * DIFF_BORDER
 *
 * `estimate` returns the maximum possible height (max lines) so the virtualizer
 * always reserves enough space; `measure` returns the exact height.
 *
 * Constants are sourced from DEFAULT_THEME.geometry so they stay consistent
 * with the new ComponentDef system.
 */

import type { FontConfig } from '../../core/measure/fonts';
import type { ChatDiff } from '../../model';
import { computeDiffRows, countChanges, selectPreview, type DiffRow } from './diff-lines';
import { langFromPath } from './lang';

const DIFF_BORDER = 1;
const DIFF_CONTEXT = 1;
const DIFF_HEADER_H = 28;
const DIFF_MAX_LINES = 12;

export type DiffMeasureResult = {
  height: number;
  /** Windowed rows to render. Empty when no changes. */
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
  const rows = computeDiffRows(item.oldText, item.newText);
  const { adds, dels } = countChanges(rows);
  const previewRows = selectPreview(rows, DIFF_MAX_LINES, DIFF_CONTEXT);
  const lang = langFromPath(item.path);

  const truncated = previewRows.length > 0 && previewRows.at(-1) !== rows.at(-1);

  const height =
    previewRows.length === 0
      ? DIFF_HEADER_H + 2 * DIFF_BORDER
      : DIFF_HEADER_H + previewRows.length * fonts.code.lineHeight + 2 * DIFF_BORDER;

  return { height, previewRows, adds, dels, lang, truncated };
}
