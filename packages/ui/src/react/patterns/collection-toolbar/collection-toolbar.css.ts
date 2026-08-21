import { style } from '@vanilla-extract/css';
import { tokenVars } from '@theme/tokens.css';

export const root = style({
  '@layer': {
    recipes: {
      display: 'flex',
      width: '100%',
      minWidth: 0,
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: tokenVars.space2,
    },
  },
});

export const search = style({
  '@layer': {
    recipes: {
      width: '100%',
      minWidth: 0,
      maxWidth: '24rem',
      flex: '1 1 14rem',
    },
  },
});

export const group = style({
  '@layer': {
    recipes: {
      display: 'flex',
      minWidth: 0,
      maxWidth: '100%',
      flex: '0 1 auto',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: tokenVars.space2,
    },
  },
});

export const spacer = style({
  '@layer': {
    recipes: {
      minWidth: 0,
      flex: '1 1 0',
    },
  },
});

export const separator = style({
  '@layer': {
    recipes: {
      display: 'flex',
      height: '1.25rem',
      alignSelf: 'center',
      alignItems: 'stretch',
    },
  },
});
