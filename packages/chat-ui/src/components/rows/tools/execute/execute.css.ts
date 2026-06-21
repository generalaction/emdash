import { style } from '@vanilla-extract/css';
import { vars } from '@styles/theme.css';
import { createVariableThemeContract } from '@styles/variable-theme-contract.css';

// ── Runtime geometry contract ─────────────────────────────────────────────────

export type ExecuteStyleVars = { rowH: number };

export const executeVars = createVariableThemeContract<ExecuteStyleVars>({ rowH: null });

export const executeRoot = style({
  height: executeVars.rowH,
  display: 'flex',
  alignItems: 'center',
});

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
