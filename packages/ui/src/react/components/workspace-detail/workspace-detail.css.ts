import '@styles/layers.css';
import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const root = style({
  '@layer': {
    recipes: {
      display: 'flex',
      minWidth: 0,
      flexDirection: 'column',
      gap: tokenVars.space4,
    },
  },
});

export const toolbar = style({
  '@layer': {
    recipes: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: tokenVars.space3,
    },
  },
});

export const summary = style({
  '@layer': {
    recipes: {
      display: 'grid',
      gridTemplateColumns: '3rem minmax(0, 1fr) minmax(9rem, 0.7fr) 10rem',
      alignItems: 'center',
      gap: tokenVars.space4,
      padding: tokenVars.space4,
      border: `1px solid ${vars.borderSubtle}`,
      borderRadius: tokenVars.radiusLg,
      backgroundColor: vars.surface,
    },
  },
});

export const summaryCell = style({
  '@layer': {
    recipes: {
      minWidth: 0,
    },
  },
});

export const gitStats = style({
  '@layer': {
    recipes: {
      display: 'inline-flex',
      gap: tokenVars.space2,
    },
  },
});

export const added = style({
  '@layer': {
    recipes: {
      color: vars.foregroundSuccess,
    },
  },
});

export const removed = style({
  '@layer': {
    recipes: {
      color: vars.foregroundError,
    },
  },
});

export const tabs = style({
  '@layer': {
    recipes: {
      minWidth: 0,
    },
  },
});

export const tabPanel = style({
  '@layer': {
    recipes: {
      marginTop: tokenVars.space3,
      padding: tokenVars.space4,
      border: `1px solid ${vars.borderSubtle}`,
      borderRadius: tokenVars.radiusLg,
      color: vars.foregroundMuted,
      fontSize: tokenVars.textSm,
    },
  },
});
