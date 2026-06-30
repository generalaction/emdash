import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const band = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  borderRadius: `${tokenVars.radiusXl} ${tokenVars.radiusXl} 0 0`,
  border: `1px solid ${vars.border}`,
  borderBottomWidth: 0,
  paddingLeft: '0.75rem',
  paddingRight: '0.75rem',
  paddingTop: '0.5rem',
  paddingBottom: '0.5rem',
  backgroundColor: vars.surface,
  color: vars.foreground,
  fontSize: tokenVars.textXs,
});

export const bandIcon = style({
  flexShrink: 0,
  width: '0.875rem',
  height: '0.875rem',
  color: vars.foregroundMuted,
});

export const bandLabel = style({
  flex: 1,
  lineHeight: 1.375,
  color: vars.foregroundMuted,
});

export const bandLabelStrong = style({
  fontWeight: 500,
  color: vars.foreground,
});

export const bandCounter = style({
  marginLeft: '0.375rem',
  opacity: 0.6,
});
