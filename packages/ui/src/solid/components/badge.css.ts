import { recipe } from '@vanilla-extract/recipes';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { vars } from '@theme/core/contract/contract.css';

export const badgeVariants = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 'var(--radius-full)',
    padding: '2px 8px',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    lineHeight: 'var(--text-xs--line-height)',
    border: '1px solid transparent',
  },
  variants: {
    variant: {
      default: {
        backgroundColor: vars.surfaceElevated,
        color: vars.foreground,
        borderColor: vars.border,
      },
      success: {
        backgroundColor: vars.backgroundSuccess,
        color: vars.foregroundSuccess,
        borderColor: vars.borderSuccess,
      },
      error: {
        backgroundColor: vars.backgroundError,
        color: vars.foregroundError,
        borderColor: vars.borderError,
      },
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

export type BadgeVariants = RecipeVariants<typeof badgeVariants>;
