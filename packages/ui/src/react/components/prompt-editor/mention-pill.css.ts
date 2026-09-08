import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';
import { kfMentionPendingPulse } from '@styles/effects/animations.css';

export const pillWrapper = style({
  display: 'inline-block',
  verticalAlign: 'baseline',
});

export const pill = style({
  position: 'relative',
  display: 'inline-flex',
  cursor: 'default',
  userSelect: 'none',
  alignItems: 'center',
  gap: '0.25rem',
  borderRadius: tokens.radius.sm,
  backgroundColor: tokens.surface.current.hover,
  paddingLeft: '0.25rem',
  paddingRight: '0.25rem',
  paddingTop: '0.125rem',
  paddingBottom: '0.125rem',
  fontSize: tokens.typography.size.xs,
  fontWeight: 400,
  color: tokens.foreground.default,
  boxShadow: `0 0 0 1px color-mix(in srgb, ${tokens.foreground.default} 10%, transparent)`,
  verticalAlign: 'baseline',
});

export const pillPending = style({
  animation: `${kfMentionPendingPulse} 1.4s ease-in-out infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      animation: 'none',
    },
  },
});

export const pillIconArea = style({
  position: 'relative',
  display: 'flex',
  width: '0.875rem',
  height: '0.875rem',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
});

export const pillRemoveBtn = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: tokens.radius.sm,
  backgroundColor: tokens.surface.current.hover,
  opacity: 0,
  transition: 'opacity 150ms',
  vars: {
    [iconSizeVar]: '0.625rem',
  },
  selectors: {
    [`${pill}:hover &`]: { opacity: 1 },
    '&:hover': { backgroundColor: tokens.surface.current.selected },
  },
});

export const pillName = style({
  maxWidth: '200px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
