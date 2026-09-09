import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { kfSpin } from '@styles/effects/animations.css';

export const card = style({
  display: 'grid',
  minWidth: 0,
  gap: '0.75rem',
});

export const row = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '0.75rem',
  width: '100%',
  borderRadius: tokens.radius.lg,
});

export const rowBody = style({
  display: 'flex',
  minWidth: 0,
  flex: '1 1 16rem',
  flexDirection: 'column',
  gap: '0.25rem',
});

export const rowTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  fontSize: tokens.typography.size.base,
  fontWeight: 400,
  color: tokens.foreground.default,
});

export const rowDescription = style({
  display: 'flex',
  alignItems: 'center',
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.muted,
});

export const rowControls = style({
  marginLeft: 'auto',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
});

export const versionBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: '1.25rem',
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  borderRadius: '999px',
  border: `1px solid ${tokens.border.default}`,
  fontFamily: tokens.typography.family.mono,
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
  whiteSpace: 'nowrap',
});

export const statusSuccess = style({
  color: tokens.feedback.success.foreground,
});

export const statusWarning = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  borderRadius: tokens.radius.sm,
  border: `1px solid ${tokens.feedback.warning.border}`,
  backgroundColor: tokens.feedback.warning.background,
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.125rem',
  paddingBottom: '0.125rem',
  fontSize: tokens.typography.size.xs,
  color: tokens.feedback.warning.foreground,
});

export const iconSpin = style({
  animationName: kfSpin,
  animationDuration: '1s',
  animationTimingFunction: 'linear',
  animationIterationCount: 'infinite',
});

export const progressTrack = style({
  height: '0.375rem',
  width: '4.5rem',
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

export const errorPill = style({
  maxWidth: '12rem',
});
