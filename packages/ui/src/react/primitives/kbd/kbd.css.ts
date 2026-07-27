import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const kbd = style({
  pointerEvents: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 'fit-content',
  minWidth: '1.25rem',
  height: '1.25rem',
  gap: tokenVars.space1,
  borderRadius: tokenVars.radiusSm,
  border: `1px solid ${vars.borderSubtle}`,
  backgroundColor: vars.backgroundSecondary,
  boxShadow: 'inset 0 -1px 0 rgba(255, 255, 255, 0.05)',
  color: vars.foregroundMuted,
  fontFamily: tokenVars.fontSans,
  fontSize: tokenVars.textTiny,
  fontWeight: tokenVars.fontWeightMedium,
  lineHeight: 1,
  paddingInline: tokenVars.space1,
  userSelect: 'none',
});

globalStyle(`${kbd} svg:not([class*='size-'])`, {
  width: '0.75rem',
  height: '0.75rem',
});

export const kbdGroup = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0,
});

globalStyle(`${kbdGroup} > ${kbd}`, {
  minWidth: 0,
  borderRadius: 0,
  paddingInline: 0,
});

globalStyle(`${kbdGroup} > ${kbd}:first-child`, {
  borderTopLeftRadius: tokenVars.radiusSm,
  borderBottomLeftRadius: tokenVars.radiusSm,
  paddingLeft: tokenVars.space1,
});

globalStyle(`${kbdGroup} > ${kbd}:last-child`, {
  borderTopRightRadius: tokenVars.radiusSm,
  borderBottomRightRadius: tokenVars.radiusSm,
  paddingRight: tokenVars.space1,
});
