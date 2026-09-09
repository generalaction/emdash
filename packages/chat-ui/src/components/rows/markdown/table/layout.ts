/**
 * layoutTable — pure geometry for a TableBlock.
 *
 * Each column is wide enough for its longest cell. If those intrinsic widths
 * fit, remaining space is distributed across the columns so the table fills
 * its container. Otherwise tableWidth exceeds contentWidth and the wrapper
 * scrolls horizontally without truncating cell content.
 *
 * Height is fully deterministic because cells stay on one line.
 */

import type { FontConfig } from '@core/config';
import type { TableLaidOut } from '@core/layout/layout-types';
import { reserveHeight } from '@core/layout/reserve-height';
import type { TableBlock } from '@core/markdown/document';
import { measureProseNaturalWidth } from '../prose/layout';
import {
  TABLE_BORDER,
  TABLE_CELL_PAD_X,
  TABLE_CELL_PAD_Y,
  TABLE_MIN_COL_W,
  TABLE_SCROLLBAR_SIZE,
} from './geometry';

function measureCellText(text: string, fonts: FontConfig, header: boolean): number {
  return measureProseNaturalWidth(
    {
      kind: 'prose',
      id: 'table-cell-width',
      variant: 'body',
      runs: text ? [{ kind: 'text', text }] : [],
    },
    header ? { ...fonts, body: fonts.bold } : fonts
  );
}

function measureColumnWidths(block: TableBlock, fonts: FontConfig): number[] {
  const columnCount = Math.max(1, block.header.length);
  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const header = block.header[columnIndex] ?? '';
    let contentWidth = measureCellText(header, fonts, true);
    for (const row of block.rows) {
      contentWidth = Math.max(contentWidth, measureCellText(row[columnIndex] ?? '', fonts, false));
    }
    return Math.max(TABLE_MIN_COL_W, Math.ceil(contentWidth) + 2 * TABLE_CELL_PAD_X + TABLE_BORDER);
  });
}

function fillAvailableWidth(widths: number[], available: number): number[] {
  const naturalWidth = widths.reduce((sum, width) => sum + width, 0);
  const extra = Math.max(0, Math.floor(available - naturalWidth));
  const extraPerColumn = Math.floor(extra / widths.length);
  const remainder = extra % widths.length;
  return widths.map((width, index) => width + extraPerColumn + (index < remainder ? 1 : 0));
}

export function layoutTable(
  block: TableBlock,
  blockTop: number,
  contentWidth: number,
  fonts: FontConfig
): TableLaidOut {
  // The table sits inside a bordered wrapper, so column width excludes the two
  // outer borders. Including them would trigger a spurious horizontal scrollbar.
  const available = Math.max(1, contentWidth - 2 * TABLE_BORDER);
  const colWidths = fillAvailableWidth(measureColumnWidths(block, fonts), available);
  const tableWidth = colWidths.reduce((sum, width) => sum + width, 0);
  // Outer top/bottom borders plus one separator after every row except the last.
  const rowCount = block.rows.length + 1;
  const rowHeight = fonts.body.lineHeight + 2 * TABLE_CELL_PAD_Y;
  const height =
    reserveHeight({
      content: rowCount * rowHeight,
      border: TABLE_BORDER,
      borderLines: rowCount + 1,
    }) + (tableWidth > available ? TABLE_SCROLLBAR_SIZE : 0);

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
