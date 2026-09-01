/**
 * table-visual.css.ts — visual styles for Table.tsx cells.
 *
 * Geometry rules (font-size, line-height, cell padding) stay in table.css.ts.
 * This file covers scrolling, borders, and background decoration.
 */

import { globalStyle, style } from '@vanilla-extract/css';
import { TABLE_BORDER, TABLE_SCROLLBAR_SIZE } from './geometry';
import { vars } from '@styles/theme.css';

/** Scroll wrapper around the table. */
export const tableScroll = style({
  border: `${TABLE_BORDER}px solid ${vars.border}`,
  borderRadius: vars.radiusLg,
  width: '100%',
  height: '100%',
  overflowX: 'auto',
  overflowY: 'hidden',
  boxSizing: 'border-box',
  scrollbarWidth: 'thin',
});

globalStyle(`${tableScroll}::-webkit-scrollbar`, {
  height: `${TABLE_SCROLLBAR_SIZE}px`,
});

/** Applied to <th> cells for visual decoration. */
export const thCell = style({
  background: vars.tableHeaderBg,
  whiteSpace: 'nowrap',
  borderRight: `${TABLE_BORDER}px solid ${vars.border}`,
  borderBottom: `${TABLE_BORDER}px solid ${vars.border}`,
  selectors: {
    '&:last-child': { borderRight: 'none' },
  },
});

/** Applied to <td> cells for visual decoration. */
export const tdCell = style({
  whiteSpace: 'nowrap',
  borderRight: `${TABLE_BORDER}px solid ${vars.border}`,
  borderBottom: `${TABLE_BORDER}px solid ${vars.border}`,
  selectors: {
    '&:last-child': { borderRight: 'none' },
  },
});

/** Remove bottom border from the last row's td cells. */
export const tdCellLastRow = style({
  borderBottom: 'none',
});
