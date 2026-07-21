import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const field = recipe({
  base: {
    display: 'flex',
    gap: '0.375rem',
    width: '100%',
  },
  variants: {
    orientation: {
      vertical: {
        flexDirection: 'column',
      },
      horizontal: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
      },
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
});

export type FieldVariants = NonNullable<RecipeVariants<typeof field>>;

// Label + description stacked, used in horizontal mode to occupy the left side.
export const fieldContent = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  gap: '0.25rem',
  minWidth: 0,
});

// Constrains the control on the right side of a horizontal field row.
// Prevents inputs/selects from filling unlimited width; callers override via className.
// display:flex + justify-content:flex-end right-aligns narrow controls (e.g. Switch).
// marginLeft:auto pushes the slot to the right edge even when FieldContent is absent.
export const fieldControlSlot = style({
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  marginLeft: 'auto',
  flexShrink: 0,
  maxWidth: '12rem',
  width: '100%',
});

export const fieldLabel = style({
  fontSize: tokenVars.textSm,
  fontWeight: 400,
  lineHeight: 1,
  color: vars.foreground,
  selectors: {
    '&[data-disabled]': { cursor: 'not-allowed', opacity: 0.7 },
  },
});

export const fieldDescription = style({
  fontSize: tokenVars.textSm,
  color: vars.foregroundMuted,
});

export const fieldError = style({
  fontSize: tokenVars.textSm,
  color: vars.foregroundDestructive,
});
