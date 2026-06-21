/**
 * execute.css.ts — geometry-coupled styles for Execute.tsx / the command chip.
 *
 * Mirrors .pexec__cmd from execute.module.css exactly.
 * The inline-code chip font metrics and padding feed pretext measurement.
 */

import { style } from '@vanilla-extract/css';
import { vars } from '../../../../styles/theme.css';

/** Inline-code chip inside the execute row — mirrors .pf--inline-code from prose.css.ts. */
export const pexecCmd = style({
  fontSize: vars.typeInlineCodeFontSize,
  fontWeight: vars.typeInlineCodeFontWeight,
  fontFamily: vars.typeInlineCodeFontFamily,
  paddingTop: vars.icPadY,
  paddingBottom: vars.icPadY,
  paddingLeft: vars.icPadX,
  paddingRight: vars.icPadX,
  display: 'inline-block',
  maxWidth: '150px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  verticalAlign: 'bottom',
});
