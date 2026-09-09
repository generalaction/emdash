import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

/**
 * TriggerButton anatomy composed with fieldControl() for input appearance.
 */
export const triggerButtonInputExtra = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.375rem',
});

/** Trailing chevron icon inside TriggerButton. */
export const triggerButtonChevron = style({
  pointerEvents: 'none',
  flexShrink: 0,
  color: tokens.foreground.passive,
});

/** TriggerButton anatomy applied on top of the shared control Recipe. */
export const triggerButtonExtra = style({
  width: 'fit-content',
  justifyContent: 'space-between',
  gap: '0.375rem',
  selectors: {
    '&[data-placeholder]': { color: tokens.foreground.passive },
  },
});

/** Component-owned wrapper for trigger label/value content. */
export const triggerButtonValue = style({
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  gap: '0.375rem',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
});
