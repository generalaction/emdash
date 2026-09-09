import { tokens } from '@emdash/theme';
import { recipe } from '@styles/index';
import type { VariantProps } from '@styles/index';
import { iconSizeVar } from '../../../styles/recipes/icon-contract';

export const statusIcon = recipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radius.md,
    flexShrink: 0,
  },
  variants: {
    severity: {
      success: {
        backgroundColor: tokens.feedback.success.background,
        color: tokens.feedback.success.foreground,
      },
      error: {
        backgroundColor: tokens.feedback.error.background,
        color: tokens.feedback.error.foreground,
      },
      warning: {
        backgroundColor: tokens.feedback.warning.background,
        color: tokens.feedback.warning.foreground,
      },
      info: {
        backgroundColor: tokens.feedback.info.background,
        color: tokens.feedback.info.foreground,
      },
      neutral: {
        backgroundColor: `color-mix(in srgb, ${tokens.foreground.muted} 12%, transparent)`,
        color: tokens.foreground.muted,
      },
    },
    size: {
      sm: {
        width: '1.25rem',
        height: '1.25rem',
        vars: {
          [iconSizeVar]: '0.75rem',
        },
      },
      md: {
        width: '1.5rem',
        height: '1.5rem',
        vars: {
          [iconSizeVar]: '0.875rem',
        },
      },
      lg: {
        width: '2.25rem',
        height: '2.25rem',
        vars: {
          [iconSizeVar]: '1.25rem',
        },
      },
    },
  },
  defaultVariants: {
    severity: 'neutral',
    size: 'md',
  },
});

export type StatusIconVariants = NonNullable<VariantProps<typeof statusIcon>>;
