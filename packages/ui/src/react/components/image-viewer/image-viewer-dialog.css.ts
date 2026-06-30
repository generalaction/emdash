import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const imageContainer = style({
  display: 'flex',
  minHeight: 0,
  flex: 1,
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  padding: '1rem',
  paddingTop: 0,
});

export const image = style({
  maxHeight: '100%',
  maxWidth: '100%',
  objectFit: 'contain',
});

export const unavailable = style({
  fontSize: tokenVars.textSm,
  color: vars.foregroundMuted,
});
