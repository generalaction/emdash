import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';
import { iconSizeVar } from '../../../styles/recipes/icon-contract';
import { kfAgentStatusDotShimmer } from '@styles/effects/animations.css';

const DOT_COUNT = 9;
const PERIOD_MS = 1200;
const dotStaticOpacity = [0.96, 0.72, 0.48, 0.72, 0.48, 0.32, 0.48, 0.32, 0.24];
const statusFill = '--_agent-status-fill';

export const agentStatus = recipe({
  base: {
    display: 'inline-flex',
    width: 'var(--_agent-status-size, 1.5rem)',
    height: 'var(--_agent-status-size, 1.5rem)',
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
      working: {
        color: tokens.foreground.muted,
      },
      'awaiting-input': {
        color: tokens.feedback.warning.foreground,
        vars: { [statusFill]: tokens.feedback.warning.background },
      },
      completed: {
        color: tokens.feedback.success.foreground,
        vars: { [statusFill]: tokens.feedback.success.background },
      },
      error: {
        color: tokens.feedback.error.foreground,
        vars: { [statusFill]: tokens.feedback.error.background },
      },
    },
  },
});

export const dot = Array.from({ length: DOT_COUNT }, (_, index) =>
  style({
    fill: 'currentColor',
    opacity: 0.28,
    transform: 'scale(0.72)',
    transformBox: 'fill-box',
    transformOrigin: 'center',
    animationName: kfAgentStatusDotShimmer,
    animationDuration: `${PERIOD_MS}ms`,
    animationTimingFunction: 'cubic-bezier(0.45, 0, 0.2, 1)',
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

export const statusShape = style({
  fill: `var(${statusFill}, transparent)`,
  stroke: 'currentColor',
});

export const errorMark = style({
  fill: 'currentColor',
  stroke: 'currentColor',
  strokeLinecap: 'round',
});
