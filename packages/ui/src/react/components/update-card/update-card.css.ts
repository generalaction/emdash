import { keyframes, style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

// ── Card shell ────────────────────────────────────────────────────────────────

export const card = style({
  display: 'grid',
  gap: '0.75rem',
});

// ── Row: title+desc left, controls right ─────────────────────────────────────

export const row = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  gap: '0.5rem 1rem',
  borderRadius: tokenVars.radiusLg,
  border: `1px solid ${vars.border}`,
  padding: '1rem',
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
  fontSize: tokenVars.textSm,
  fontWeight: 500,
  color: vars.foreground,
});

export const rowDescription = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.25rem',
  fontSize: tokenVars.textXs,
  color: vars.foregroundMuted,
});

export const rowControls = style({
  marginLeft: 'auto',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
});

// ── Version badge ─────────────────────────────────────────────────────────────

export const versionBadge = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: '1.25rem',
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  borderRadius: '999px',
  border: `1px solid ${vars.border}`,
  fontFamily: tokenVars.fontMono,
  fontSize: tokenVars.textXs,
  color: vars.foregroundMuted,
  whiteSpace: 'nowrap',
});

// ── Status message variants ───────────────────────────────────────────────────

export const statusSuccess = style({
  color: vars.foregroundSuccess,
});

export const statusWarning = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  borderRadius: tokenVars.radiusSm,
  border: `1px solid ${vars.borderWarning}`,
  backgroundColor: vars.backgroundWarning,
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.125rem',
  paddingBottom: '0.125rem',
  fontSize: tokenVars.textXs,
  color: vars.foregroundWarning,
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
});

// ── Progress bar ──────────────────────────────────────────────────────────────

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
