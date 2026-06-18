/**
 * tableDef — ComponentDef for TableBlock / TableLaidOut (block kind).
 *
 * Height formula: (1 + rows.length) * TABLE_ROW_H + (rows.length + 2) * TABLE_BORDER
 * `measure()` always passes `blockTop: 0`; the parent stack combinator
 * supplies the actual vertical offset.
 */

import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { TableLaidOut } from '../../core/layout/layout-types';
import { reserveHeight } from '../../core/layout/reserve-height';
import type { TableBlock } from '../../core/markdown/document';
import { Table } from './Table';

/** Border width (px) around each table cell. */
const TABLE_BORDER = 1;
/** Minimum column width (px). */
const TABLE_MIN_COL_W = 80;

export type TableDefLayout = TableLaidOut;

function TableRender(props: {
  item: TableBlock;
  layout: Measured<TableDefLayout>;
  ctx: RenderCtx;
}) {
  return <Table block={props.layout.layout} />;
}

export const tableDef = defineComponent<TableBlock, TableDefLayout>({
  kind: 'table',

  estimate(item, ctx: MeasureCtx): number {
    // Table row height: body line-height + 12px vertical padding per row.
    const tableRowH = ctx.theme.fonts.body.lineHeight + 12;
    const rowCount = item.rows.length + 1;
    return reserveHeight({
      content: rowCount * tableRowH,
      border: TABLE_BORDER,
      borderLines: rowCount + 1,
    });
  },

  measure(item, ctx: MeasureCtx): Measured<TableDefLayout> {
    const tableRowH = ctx.theme.fonts.body.lineHeight + 12;
    const colCount = Math.max(1, item.header.length);
    const available = ctx.width - 2 * TABLE_BORDER;
    const target = Math.floor(available / colCount);
    const colW = Math.max(TABLE_MIN_COL_W, target);
    const colWidths = Array<number>(colCount).fill(colW);
    const tableWidth = colW * colCount;
    const rowCount = item.rows.length + 1;
    const height = reserveHeight({
      content: rowCount * tableRowH,
      border: TABLE_BORDER,
      borderLines: rowCount + 1,
    });

    const laid: TableLaidOut = {
      kind: 'table',
      id: item.id,
      top: 0,
      height,
      contentWidth: tableWidth,
      colWidths,
      tableWidth,
      header: item.header,
      rows: item.rows,
    };

    return {
      height,
      width: tableWidth,
      layout: laid,
    };
  },

  Render: TableRender,
});
