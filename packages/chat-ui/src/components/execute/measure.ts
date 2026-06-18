/**
 * measureExecute — constant height for ChatExecute rows.
 *
 * Returns content height only; Row.tsx adds the per-kind wrapper padding.
 */

import type { ChatExecute } from '../../model';

export const EXEC_ROW_H = 28;

export function measureExecute(_item: ChatExecute): number {
  return EXEC_ROW_H;
}
