import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';
import { kfPillDotPulse } from '@styles/effects/animations.css';

export const root = recipe({
  base: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.125rem 0.75rem',
    borderRadius: '9999px',
    fontSize: tokens.typography.size.xs,
    fontWeight: 500,
    lineHeight: tokens.typography.lineHeight.xs,
    whiteSpace: 'nowrap',
  },
  variants: {
    tone: {
      neutral: {
        color: tokens.foreground.muted,
        backgroundColor: `color-mix(in srgb, ${tokens.foreground.muted} 10%, transparent)`,
      },
      success: {
        color: tokens.feedback.success.foreground,
        backgroundColor: `color-mix(in srgb, ${tokens.feedback.success.foreground} 12%, transparent)`,
      },
      warning: {
        color: tokens.feedback.warning.foreground,
        backgroundColor: `color-mix(in srgb, ${tokens.feedback.warning.foreground} 12%, transparent)`,
      },
      error: {
        color: tokens.feedback.error.foreground,
        backgroundColor: `color-mix(in srgb, ${tokens.feedback.error.foreground} 12%, transparent)`,
      },
      info: {
        color: tokens.feedback.info.foreground,
        backgroundColor: `color-mix(in srgb, ${tokens.feedback.info.foreground} 12%, transparent)`,
      },
    },
    truncate: {
      true: {
        maxWidth: '100%',
        overflow: 'hidden',
      },
    },
  },
  defaultVariants: {
    tone: 'neutral',
    truncate: false,
  },
});

export const label = recipe({
  base: {
    minWidth: 0,
    color: 'currentColor',
  },
  variants: {
    truncate: {
      true: {
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
    },
  },
  defaultVariants: {
    truncate: false,
  },
});

export const dot = style({
  width: '0.375rem',
  height: '0.375rem',
  borderRadius: '50%',
  backgroundColor: 'currentColor',
  flexShrink: 0,
});

export const pulsingDot = style({
  animationName: kfPillDotPulse,
  animationDuration: '1.5s',
  animationTimingFunction: 'ease-in-out',
  animationIterationCount: 'infinite',
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animationName: 'none',
    },
  },
});
