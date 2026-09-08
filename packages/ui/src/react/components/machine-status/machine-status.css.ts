import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';
import { iconSizeVar } from '../../../styles/recipes/icon-contract';

const statusDotColor = '--_machine-status-dot-color';

export const machineStatus = recipe({
  base: {
    display: 'inline-flex',
    width: 'var(--_machine-status-size, 1.5rem)',
    height: 'var(--_machine-status-size, 1.5rem)',
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
      idle: {
        vars: { [statusDotColor]: tokens.foreground.muted },
      },
      successful: {
        vars: { [statusDotColor]: tokens.feedback.success.foreground },
      },
      error: {
        vars: { [statusDotColor]: tokens.feedback.error.foreground },
      },
      initializing: {
        vars: { [statusDotColor]: tokens.feedback.info.foreground },
      },
    },
  },
});

export const backgroundSegment = style({
  fill: tokens.palette.neutral.step4,
});

export const dot = style({
  fill: tokens.foreground.default,
  opacity: 0.6,
});

export const statusDot = style({
  fill: `var(${statusDotColor})`,
  stroke: tokens.palette.neutral.step1,
  strokeWidth: '1.5',
});
