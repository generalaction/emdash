import '@styles/layers.css';
import { globalStyle, style } from '@vanilla-extract/css';
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
      overflow: 'hidden',
      border: `1px solid ${vars.border}`,
      borderRadius: tokenVars.radiusLg,
      backgroundColor: vars.surface,
    },
  },
});

export const headerRow = style({
  '@layer': {
    recipes: {
      flexShrink: 0,
      borderBottom: `1px solid ${vars.border}`,
      padding: '0.5rem 0.75rem',
      fontSize: tokenVars.textXs,
      color: vars.foregroundMuted,
    },
  },
});

export const rowGrid = style({
  '@layer': {
    recipes: {
      display: 'grid',
      width: '100%',
      gridTemplateColumns: '2.25rem minmax(0, 1fr) 9rem 8rem 9rem',
      alignItems: 'center',
      columnGap: tokenVars.space3,
    },
  },
});

export const pathRegion = style({
  '@layer': {
    recipes: {
      display: 'flex',
      minWidth: 0,
      gridColumn: '1 / span 2',
      alignItems: 'center',
      gap: tokenVars.space3,
    },
  },
});

export const iconTile = style({
  '@layer': {
    recipes: {
      display: 'flex',
      width: '2.25rem',
      height: '2.25rem',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: tokenVars.radiusLg,
      backgroundColor: vars.background1,
      color: vars.foregroundMuted,
      transition: 'background-color 100ms',
    },
  },
});

globalStyle(`[data-slot='list-row']:hover ${iconTile}`, {
  backgroundColor: vars.background2,
});

export const cell = style({
  '@layer': {
    recipes: {
      display: 'flex',
      minWidth: 0,
      flexDirection: 'column',
      gap: '0.125rem',
    },
  },
});

export const cellPrimary = style({
  '@layer': {
    recipes: {
      overflow: 'hidden',
      fontSize: tokenVars.textSm,
      lineHeight: tokenVars.textSmLineHeight,
      color: vars.foreground,
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  },
});

export const cellSecondary = style({
  '@layer': {
    recipes: {
      overflow: 'hidden',
      fontSize: tokenVars.textXs,
      lineHeight: tokenVars.textXsLineHeight,
      color: vars.foregroundMuted,
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  },
});
