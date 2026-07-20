import { style } from '@vanilla-extract/css';
import { tokenVars } from '@theme/tokens.css';

export const root = style({
  display: 'flex',
  minHeight: 0,
  width: '100%',
  flexDirection: 'column',
  paddingBottom: tokenVars.space4,
});

export const body = style({
  display: 'flex',
  minHeight: 0,
  flex: '1 1 auto',
  flexDirection: 'column',
});
