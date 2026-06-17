/**
 * measureExecute — constant height for ChatExecute rows.
 *
 * Returns content height only; Row.tsx adds the per-kind wrapper padding.
 * Constant sourced from DEFAULT_THEME.geometry for consistency.
 */

import { DEFAULT_THEME } from '../../core/theme';
import type { ChatExecute } from '../../model';

export const EXEC_ROW_H = DEFAULT_THEME.geometry.execRowH;

export function measureExecute(_item: ChatExecute): number {
  return EXEC_ROW_H;
}
