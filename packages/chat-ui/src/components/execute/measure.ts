/**
 * measureExecute — constant height for ChatExecute rows.
 *
 * Returns content height only; Row.tsx adds the per-kind wrapper padding.
 */

import type { ChatExecute } from '../../model';
import { EXEC_ROW_H } from './metrics';

export function measureExecute(_item: ChatExecute): number {
  return EXEC_ROW_H;
}
