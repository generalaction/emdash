import { globalStyle, style } from '@vanilla-extract/css';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { recipe } from '@vanilla-extract/recipes';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const rowWrapper = style({
  width: '100%',
  paddingBlock: tokenVars.space0_5,
});

export const row = recipe({
  base: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: tokenVars.space3,
    border: 0,
    borderRadius: tokenVars.radiusLg,
    padding: tokenVars.space3,
    color: 'inherit',
    font: 'inherit',
    background: 'transparent',
    appearance: 'none',
    transition: 'background-color 100ms',
  },
  variants: {
    interactive: {
      true: {
        cursor: 'pointer',
        textAlign: 'left',
        selectors: {
          '&:hover': { backgroundColor: vars.background1 },
        },
      },
    },
    selected: {
      true: {
        backgroundColor: vars.surfaceSelected,
      },
    },
  },
  compoundVariants: [
    {
      variants: { interactive: true, selected: true },
      style: {
        selectors: {
          '&:hover': { backgroundColor: vars.surfaceSelected },
        },
      },
    },
  ],
  defaultVariants: {
    interactive: false,
    selected: false,
  },
});

export type RowVariants = NonNullable<RecipeVariants<typeof row>>;

export const rowIcon = style({
  display: 'flex',
  width: '1.5rem',
  height: '1.5rem',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: tokenVars.radiusLg,
  padding: tokenVars.space1_5,
  backgroundColor: vars.background1,
  transition: 'background-color 100ms',
});

globalStyle(`[data-slot='list-page-row'][data-interactive]:hover ${rowIcon}`, {
  backgroundColor: vars.background2,
});

export const rowContent = style({
  display: 'flex',
  minWidth: 0,
  flex: '1 1 0%',
  flexDirection: 'column',
  gap: tokenVars.space0_5,
});

export const rowTitle = style({
  overflow: 'hidden',
  color: vars.foreground,
  fontSize: tokenVars.textSm,
  lineHeight: tokenVars.textSmLineHeight,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const rowDescription = style({
  overflow: 'hidden',
  color: vars.foregroundMuted,
  fontSize: tokenVars.textXs,
  lineHeight: tokenVars.textXsLineHeight,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const rowTrailing = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: tokenVars.space1_5,
  marginLeft: 'auto',
});
