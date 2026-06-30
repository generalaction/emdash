import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const calloutRoot = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.75rem',
  borderRadius: tokenVars.radiusLg,
  border: '1px solid',
  paddingLeft: '1rem',
  paddingRight: '1rem',
  paddingTop: '0.75rem',
  paddingBottom: '0.75rem',
  fontSize: tokenVars.textSm,
  // Colors come from the .surface-<status> cascade class applied by Surface
  backgroundColor: vars.surface,
  borderColor: vars.surfaceBorder,
  color: vars.surfaceForeground,
});

export const calloutIcon = style({
  marginTop: '0.125rem',
  flexShrink: 0,
});
globalStyle(`${calloutIcon} svg:not([class*='size-'])`, { width: '1rem', height: '1rem' });

export const calloutContent = style({
  minWidth: 0,
  flex: '1 1 0%',
});
