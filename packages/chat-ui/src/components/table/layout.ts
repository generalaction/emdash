/**
 * layoutTable — pure geometry for a TableBlock.
 *
 * Column widths are distributed equally across the available contentWidth,
 * but each column is floored at TABLE_MIN_COL_W. When the floor kicks in the
 * tableWidth exceeds contentWidth — the wrapper handles horizontal scroll.
 *
 * Height is fully deterministic: every row (header + data) is exactly
 * TABLE_ROW_H tall because cells are single-line truncated.
 */

import type { TableBlock } from '../../core/blocks/block-types';
import type { TableLaidOut } from '../../core/layout/layout-types';
import { reserveHeight } from '../../core/layout/reserve-height';
import { TABLE_BORDER, TABLE_MIN_COL_W, TABLE_ROW_H } from './metrics';

export function layoutTable(
  block: TableBlock,
  blockTop: number,
  contentWidth: number
): TableLaidOut {
  const colCount = Math.max(1, block.header.length);
  const target = Math.floor(contentWidth / colCount);
  const colW = Math.max(TABLE_MIN_COL_W, target);
  const colWidths = Array<number>(colCount).fill(colW);
  const tableWidth = colW * colCount;
  // +1 for the header row; border-collapse draws rowCount+1 horizontal grid lines
  const rowCount = block.rows.length + 1;
  const height = reserveHeight({
    content: rowCount * TABLE_ROW_H,
    border: TABLE_BORDER,
    borderLines: rowCount + 1,
  });

  return {
    kind: 'table',
    id: block.id,
    top: blockTop,
    height,
    contentWidth: tableWidth,
    colWidths,
    tableWidth,
    header: block.header,
    rows: block.rows,
  };
}
