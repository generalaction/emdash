/**
 * inputVariants — Vanilla Extract recipe replacing the CVA inputVariants.
 * Used by Input, Textarea, and InputGroup control slots.
 */

import { recipe } from '@vanilla-extract/recipes';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { vars } from '../../theme/core/contract/contract.css';

export const inputVariants = recipe({
  base: {
    width: '100%',
    minWidth: 0,
    borderRadius: 'var(--radius-md)',
    border: `1px solid ${vars.border}`,
    backgroundColor: vars.surfaceInput,
    fontSize: 'var(--text-sm)',
    color: vars.foreground,
    transition: 'color 150ms, box-shadow 150ms',
    outline: 'none',
    colorScheme: 'light',
    selectors: {
      '&::placeholder': { color: vars.foregroundPassive },
      '&:hover': { borderColor: vars.border1 },
      '&:focus-visible': {
        borderColor: vars.borderPrimary,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${vars.borderPrimary} 30%, transparent)`,
      },
      '&:disabled': {
        pointerEvents: 'none',
        cursor: 'not-allowed',
        opacity: 0.5,
      },
      '&[aria-invalid="true"]': {
        borderColor: vars.borderDestructive,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${vars.borderDestructive} 20%, transparent)`,
      },
    },
  },

  variants: {
    size: {
      base: {
        height: '2rem',
        paddingLeft: '0.625rem',
        paddingRight: '0.625rem',
        paddingTop: '0.25rem',
        paddingBottom: '0.25rem',
      },
      sm: {
        height: '1.5rem',
        paddingLeft: '0.5rem',
        paddingRight: '0.5rem',
        paddingTop: '0.125rem',
        paddingBottom: '0.125rem',
        fontSize: 'var(--text-xs)',
      },
    },
  },

  defaultVariants: {
    size: 'base',
  },
});

export type InputVariantProps = NonNullable<RecipeVariants<typeof inputVariants>>;
