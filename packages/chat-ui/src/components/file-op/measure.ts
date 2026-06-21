/**
 * measureFileOp — pure height arithmetic for ChatFileOpToolCall rows.
 *
 * No DOM / Solid imports. Testable in the node Vitest project.
 * All geometry constants come from `fileOpUnitDef.vars`; this file holds only
 * the arithmetic so the same formulas can be exercised in the node test suite.
 *
 * Collapse semantics are inverted:
 *   isExpanded(id) maps to viewState.isCollapsed(id).
 *   Default absent/false → not expanded.
 */

import type { ChatFileOpToolCall } from '../../model';
import type { FileOpVars } from './file-op.def';

export function measureFileOp(
  item: ChatFileOpToolCall,
  isExpanded: (id: string) => boolean,
  vars: FileOpVars,
): number {
  if (item.ops.length <= 1) return vars.rowH;

  if (isExpanded(item.id)) {
    return vars.rowH + item.ops.length * vars.rowH + 2 * vars.padY;
  }

  if (item.status === 'running') return vars.rowH + vars.windowH;

  return vars.rowH;
}
