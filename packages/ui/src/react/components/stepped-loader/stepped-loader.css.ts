import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import {
  kfSteppedLoaderEnterFromBottom,
  kfSteppedLoaderExitUp,
} from '@styles/effects/animations.css';

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  flex: 1,
  minHeight: 0,
  gap: '0.5rem',
  color: tokens.foreground.default,
});

export const label = style({
  fontSize: tokens.typography.size.xs,
  fontWeight: 400,
  color: tokens.foreground.muted,
});

export const progressHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: tokens.typography.size.sm,
  fontWeight: 400,
  color: tokens.foreground.muted,
});

export const progressContainer = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  border: `1px solid ${tokens.border.default}`,
  borderRadius: tokens.radius.lg,
  padding: '1rem',
});

export const stepViewport = style({
  minHeight: '1.75rem',
  display: 'flex',
  marginTop: '30%',
  alignItems: 'center',
  overflow: 'hidden',
});

export const stepRow = style({
  display: 'grid',
  gridTemplateColumns: '1.25rem minmax(0, 1fr)',
  alignItems: 'center',
  gap: '0.5rem',
  minWidth: 0,
});

export const iconSlot = style({
  display: 'inline-flex',
  width: '1.25rem',
  height: '1.25rem',
  alignItems: 'center',
  justifyContent: 'center',
});

export const iconPending = style({
  color: tokens.foreground.passive,
});

export const iconLoading = style({
  color: tokens.foreground.muted,
});

export const iconError = style({
  color: tokens.feedback.error.foreground,
});

export const stepName = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: tokens.typography.size.lg,
  fontWeight: 400,
  color: tokens.foreground.default,
});

export const stepChildren = style({});

export const footer = style({
  // Pushes the footer to the bottom of the container when extra vertical space
  // is available (auto margin absorbs the free space), so it visibly floats to
  // the bottom. In an auto-height container it collapses to the normal gap.
  marginTop: 'auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
  borderRadius: tokens.radius.lg,
  border: `1px solid ${tokens.border.default}`,
  backgroundColor: tokens.palette.neutral.step2,
  padding: '0.375rem 0.375rem 0.375rem 0.75rem',
});

export const footerProgress = style({
  fontFamily: tokens.typography.family.mono,
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.muted,
  whiteSpace: 'nowrap',
});

export const footerActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
});

export const stepExit = style({
  animationName: kfSteppedLoaderExitUp,
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
  animationName: kfSteppedLoaderEnterFromBottom,
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
  backgroundColor: tokens.palette.neutral.step3,
});

export const progressFill = style({
  height: '100%',
  borderRadius: '999px',
  backgroundColor: tokens.foreground.default,
  transition: 'width 300ms ease-out',
});
