import { keyframes, style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const root = style({
  display: 'grid',
  width: '100%',
  gap: '0.75rem',
  color: vars.foreground,
});

export const label = style({
  fontSize: tokenVars.textXs,
  fontWeight: 500,
  color: vars.foregroundMuted,
});

export const stepViewport = style({
  minHeight: '3rem',
  overflow: 'hidden',
});

export const stepPanel = style({
  display: 'grid',
  gap: '0.5rem',
});

export const stepRow = style({
  display: 'grid',
  gridTemplateColumns: '1rem minmax(0, 1fr)',
  alignItems: 'center',
  gap: '0.5rem',
  minWidth: 0,
});

export const iconSlot = style({
  display: 'inline-flex',
  width: '1rem',
  height: '1rem',
  alignItems: 'center',
  justifyContent: 'center',
});

export const iconPending = style({
  color: vars.foregroundPassive,
});

export const iconLoading = style({
  color: vars.foregroundMuted,
});

export const iconSuccess = style({
  color: vars.foregroundSuccess,
});

export const iconError = style({
  color: vars.foregroundError,
});

export const stepName = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokenVars.textSm,
  fontWeight: 500,
  color: vars.foreground,
});

export const stepChildren = style({
  marginLeft: '1.5rem',
});

export const divider = style({
  height: '1px',
  width: '100%',
  backgroundColor: vars.border,
});

export const actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '0.5rem',
});

const spinKeyframes = keyframes({
  from: { transform: 'rotate(0deg)' },
  to: { transform: 'rotate(360deg)' },
});

export const iconSpin = style({
  animationName: spinKeyframes,
  animationDuration: '1s',
  animationTimingFunction: 'linear',
  animationIterationCount: 'infinite',
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animationDuration: '1ms',
      animationIterationCount: 1,
    },
  },
});

const stepExitUpKeyframes = keyframes({
  from: {
    opacity: 1,
    transform: 'translateY(0)',
  },
  to: {
    opacity: 0,
    transform: 'translateY(-8px)',
  },
});

const stepEnterFromBottomKeyframes = keyframes({
  from: {
    opacity: 0,
    transform: 'translateY(8px)',
  },
  to: {
    opacity: 1,
    transform: 'translateY(0)',
  },
});

export const stepExit = style({
  animationName: stepExitUpKeyframes,
  animationDuration: '220ms',
  animationTimingFunction: 'ease-in',
  animationFillMode: 'forwards',
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animationDuration: '1ms',
      transform: 'none',
    },
  },
});

export const stepEnter = style({
  animationName: stepEnterFromBottomKeyframes,
  animationDuration: '180ms',
  animationTimingFunction: 'ease-out',
  animationFillMode: 'both',
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animationDuration: '1ms',
      transform: 'none',
    },
  },
});

export const progressTrack = style({
  height: '0.375rem',
  width: '100%',
  overflow: 'hidden',
  borderRadius: '999px',
  backgroundColor: vars.background2,
});

export const progressFill = style({
  height: '100%',
  borderRadius: '999px',
  backgroundColor: vars.selection,
  transition: 'width 300ms ease-out',
});
