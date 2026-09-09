import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';
import { iconSizeVar } from '../../../styles/recipes/icon-contract';
import { kfScriptStatusDotPulse } from '@styles/effects/animations.css';

const DOT_COUNT = 4;
const PERIOD_MS = 1000;
const dotStaticOpacity = [1, 0.72, 0.48, 0.32];

export const scriptStatus = recipe({
  base: {
    display: 'inline-flex',
    width: 'var(--_script-status-size, 1.5rem)',
    height: 'var(--_script-status-size, 1.5rem)',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    verticalAlign: 'middle',
    vars: {
      [iconSizeVar]: '100%',
    },
  },
  variants: {
    status: {
      success: {
        color: tokens.feedback.success.foreground,
      },
      error: {
        color: tokens.feedback.error.foreground,
      },
      'in-progress': {
        color: tokens.foreground.muted,
      },
      waiting: {
        color: tokens.foreground.passive,
      },
      cancelled: {
        color: tokens.foreground.muted,
      },
    },
  },
});

export const dot = Array.from({ length: DOT_COUNT }, (_, index) =>
  style({
    fill: 'currentColor',
    opacity: 0.28,
    transform: 'scale(0.8)',
    transformBox: 'fill-box',
    transformOrigin: 'center',
    animationName: kfScriptStatusDotPulse,
    animationDuration: `${PERIOD_MS}ms`,
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
    animationDelay: `${-((DOT_COUNT - index) % DOT_COUNT) * (PERIOD_MS / DOT_COUNT)}ms`,
    '@media': {
      '(prefers-reduced-motion: reduce)': {
        animationName: 'none',
        opacity: dotStaticOpacity[index]?.toString() ?? '0.48',
        transform: 'scale(0.9)',
      },
    },
  })
);
