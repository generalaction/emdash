/**
 * tableSpec — BlockSpec for TableBlock / TableLaidOut.
 *
 * Tables are formula-measured: height is determined entirely from the row count
 * and the static TABLE_ROW_H constant, with no DOM write-back required.
 */

import type { TableBlock } from '../../core/blocks/block-types';
import type { FontConfig } from '../../core/measure/fonts';
import type { BlockSpec } from '../../core/layout/spec-types';
import type { TableLaidOut } from '../../core/layout/layout-types';
import { layoutTable } from './layout';
import { TABLE_BORDER, TABLE_MIN_COL_W, TABLE_ROW_H } from './metrics';

export const tableSpec: BlockSpec<TableBlock, TableLaidOut> = {
  metrics: {
    rowHeight: TABLE_ROW_H,
    border: TABLE_BORDER,
    minColWidth: TABLE_MIN_COL_W,
  },

  cssVars() {
    return {
      '--chat-table-row-h': `${TABLE_ROW_H}px`,
      '--chat-table-header-bg': 'var(--background-1, #f1f5f9)',
    };
  },

  layout(block: TableBlock, _fonts: FontConfig, top: number, width: number): TableLaidOut {
    return layoutTable(block, top, width);
  },
};
