import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const section = style({
  paddingTop: tokenVars.space4,
});

export const sectionHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: tokenVars.space1,
  paddingBlock: tokenVars.space2,
  paddingInline: tokenVars.space3,
  color: vars.foregroundMuted,
  fontSize: tokenVars.textSm,
  fontWeight: tokenVars.fontWeightNormal,
  letterSpacing: '-0.01em',
  lineHeight: 1,
});

export const separator = style({
  width: '100%',
  height: 1,
  flexShrink: 0,
  backgroundColor: vars.border,
});
