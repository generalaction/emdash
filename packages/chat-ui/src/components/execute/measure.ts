/**
 * measureExecute — constant height for ChatExecute rows.
 *
 * The row is non-collapsible, so height is always EXEC_ROW_H + ROW_GAP.
 */

import { ROW_GAP } from '../../core/metrics';
import type { ChatExecute } from '../../model';
import { EXEC_ROW_H } from './metrics';

export function measureExecute(_item: ChatExecute): number {
  return EXEC_ROW_H + ROW_GAP;
}
