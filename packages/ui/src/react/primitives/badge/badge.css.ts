import { tokens } from '@emdash/theme';
import { recipe } from '@styles/index';
import type { VariantProps } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';

export const badge = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 'fit-content',
    height: '1.125rem',
    flexShrink: 0,
    gap: '0.25rem',
    overflow: 'hidden',
    padding: '0 0.375rem',
    borderRadius: tokens.radius.full,
    border: '1px solid transparent',
    fontSize: tokens.typography.size.micro,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    transition: 'color 150ms, background-color 150ms, border-color 150ms',
    vars: {
      [iconSizeVar]: '0.75rem',
    },
    selectors: {
      '&:focus-visible': {
        outline: 'none',
        borderColor: tokens.border.focus,
        boxShadow: `0 0 0 3px color-mix(in srgb, ${tokens.border.focus} 30%, transparent)`,
      },
    },
  },

  variants: {
    // Tone owns `color`; the variant derives its background/border from
    // currentColor so every tone × variant combination stays consistent.
    variant: {
      soft: {
        backgroundColor: 'color-mix(in srgb, currentColor 10%, transparent)',
      },
      outline: {
        backgroundColor: 'transparent',
        borderColor: 'color-mix(in srgb, currentColor 35%, transparent)',
      },
    },
    tone: {
      neutral: { color: tokens.foreground.muted },
      success: { color: tokens.feedback.success.foreground },
      warning: { color: tokens.feedback.warning.foreground },
      error: { color: tokens.feedback.error.foreground },
      info: { color: tokens.feedback.info.foreground },
    },
  },

  compoundVariants: [
    // Neutral outline reads as a quiet chip: full foreground text, hairline border.
    {
      variants: { variant: 'outline', tone: 'neutral' },
      style: { color: tokens.foreground.default, borderColor: tokens.border.default },
    },
  ],

  defaultVariants: {
    variant: 'soft',
    tone: 'neutral',
  },
});

export type BadgeVariants = NonNullable<VariantProps<typeof badge>>;
