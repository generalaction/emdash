import '@styles/layers.css';
import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const root = style({
  '@layer': {
    recipes: {
      display: 'flex',
      width: '100%',
      height: '100%',
      minHeight: 0,
      flexDirection: 'column',
    },
  },
});

export const rowContent = style({
  '@layer': {
    recipes: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      minWidth: 0,
      width: '100%',
    },
  },
});

export const content = style({
  '@layer': {
    recipes: {
      minWidth: 0,
      flex: 1,
      fontSize: tokenVars.textSm,
      color: vars.foreground,
    },
  },
});
