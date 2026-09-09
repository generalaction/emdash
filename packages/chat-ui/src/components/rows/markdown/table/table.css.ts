/**
 * table.css.ts — geometry-coupled styles for Table.tsx.
 *
 * Cell padding and line-height determine the row height used by layoutTable.
 * Keep the shared geometry constants in sync through geometry.ts.
 */

import { style } from '@vanilla-extract/css';
import { TABLE_CELL_PAD_X, TABLE_CELL_PAD_Y } from './geometry';
import { vars } from '@styles/theme.css';

export const pchatTable = style({
  borderCollapse: 'separate',
  borderSpacing: 0,
  // Typography must reproduce the FontConfig used by layoutTable.
  fontFamily: vars.typeBodyFontFamily,
  fontSize: vars.typeBodyFontSize,
  fontWeight: vars.typeBodyFontWeight,
  lineHeight: vars.typeBodyLineHeight,
});

// Cell geometry — padding plus the configured body line-height defines row height.
export const tableCell = style({
  padding: `${TABLE_CELL_PAD_Y}px ${TABLE_CELL_PAD_X}px`,
  textAlign: 'left',
});

export const tableHeaderCell = style({
  fontWeight: vars.typeBodyBoldFontWeight,
});
