import { keyframes, style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';

const dotPulse = keyframes({
  '0%, 100%': {
    opacity: 1,
  },
  '50%': {
    opacity: 0.4,
  },
});

export const root = style({
  '@layer': {
    recipes: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.375rem',
      padding: '0.125rem 0.5rem',
      borderRadius: '9999px',
      fontSize: 'var(--em-text-xs)',
      fontWeight: 500,
      lineHeight: 'var(--em-text-xs--line-height)',
      whiteSpace: 'nowrap',
    },
  },
});

export const label = style({
  '@layer': {
    recipes: {
      color: 'currentColor',
    },
  },
});

export const dot = style({
  '@layer': {
    recipes: {
      width: '0.375rem',
      height: '0.375rem',
      borderRadius: '50%',
      backgroundColor: 'currentColor',
      flexShrink: 0,
    },
  },
});

export const pulsingDot = style({
  '@layer': {
    recipes: {
      animationName: dotPulse,
      animationDuration: '1.5s',
      animationTimingFunction: 'ease-in-out',
      animationIterationCount: 'infinite',
      '@media': {
        '(prefers-reduced-motion: reduce)': {
          animationName: 'none',
        },
      },
    },
  },
});

export const variant = {
  neutral: style({
    '@layer': {
      recipes: {
        color: vars.foregroundMuted,
        backgroundColor: vars.background3,
      },
    },
  }),
  success: style({
    '@layer': {
      recipes: {
        color: vars.foregroundSuccess,
        backgroundColor: vars.backgroundSuccess,
      },
    },
  }),
  warning: style({
    '@layer': {
      recipes: {
        color: vars.foregroundWarning,
        backgroundColor: vars.backgroundWarning,
      },
    },
  }),
  error: style({
    '@layer': {
      recipes: {
        color: vars.foregroundError,
        backgroundColor: vars.backgroundError,
      },
    },
  }),
  info: style({
    '@layer': {
      recipes: {
        color: vars.foregroundInfo,
        backgroundColor: vars.backgroundInfo,
      },
    },
  }),
};
