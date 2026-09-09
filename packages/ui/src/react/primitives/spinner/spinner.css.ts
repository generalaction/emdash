import { style } from '@styles/index';
import { kfSpin } from '@styles/effects/animations.css';

export const spinner = style({
  animationName: kfSpin,
  animationDuration: '1s',
  animationTimingFunction: 'linear',
  animationIterationCount: 'infinite',
  flexShrink: 0,
});

export const size = {
  sm: style({ width: '1rem', height: '1rem' }),
  md: style({ width: '1.25rem', height: '1.25rem' }),
  lg: style({ width: '1.5rem', height: '1.5rem' }),
} as const;

export const track = style({ opacity: 0.25 });

export const arc = style({ opacity: 0.75 });
