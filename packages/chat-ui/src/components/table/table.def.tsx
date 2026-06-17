/**
 * tableDef — ComponentDef for TableBlock / TableLaidOut (block tier).
 *
 * Wraps layoutTable() with theme-threaded geometry constants.
 * `measure()` always passes `blockTop: 0`; the parent stack combinator
 * supplies the actual vertical offset.
 */

import type { TableBlock } from '../../core/blocks/block-types';
import { defineComponent, type Measured, type MeasureCtx, type RenderCtx } from '../../core/define';
import type { TableLaidOut } from '../../core/layout/layout-types';
import { reserveHeight } from '../../core/layout/reserve-height';
import { Table } from './Table';

export type TableDefLayout = TableLaidOut & { kind: 'table' };

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
    const { tableRowH, tableBorder } = ctx.theme.geometry;
    const rowCount = item.rows.length + 1;
    return reserveHeight({
      content: rowCount * tableRowH,
      border: tableBorder,
      borderLines: rowCount + 1,
    });
  },

  measure(item, ctx: MeasureCtx): Measured<TableDefLayout> {
    const { tableRowH, tableBorder, tableMinColW } = ctx.theme.geometry;
    const colCount = Math.max(1, item.header.length);
    const available = ctx.width - 2 * tableBorder;
    const target = Math.floor(available / colCount);
    const colW = Math.max(tableMinColW, target);
    const colWidths = Array<number>(colCount).fill(colW);
    const tableWidth = colW * colCount;
    const rowCount = item.rows.length + 1;
    const height = reserveHeight({
      content: rowCount * tableRowH,
      border: tableBorder,
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
      layout: { ...laid, kind: 'table' },
    };
  },

  Render: TableRender,
});
