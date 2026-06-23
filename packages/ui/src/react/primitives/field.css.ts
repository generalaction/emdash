import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.375rem',
});

export const fieldLabel = style({
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  lineHeight: 1,
  color: vars.foreground,
  // base-ui Field propagates data-disabled to the label element
  selectors: {
    '&[data-disabled]': { cursor: 'not-allowed', opacity: 0.7 },
  },
});

export const fieldDescription = style({
  fontSize: 'var(--text-sm)',
  color: vars.foregroundMuted,
});

export const fieldError = style({
  fontSize: 'var(--text-sm)',
  color: vars.foregroundDestructive,
});
