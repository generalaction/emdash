import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

export const trigger = style({
  minWidth: 0,
});

export const triggerLabel = style({
  display: 'inline-flex',
  minWidth: 0,
  flex: 1,
  alignItems: 'center',
  lineHeight: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'left',
});

export const triggerChevron = style({
  color: tokens.foreground.muted,
});

/** Default min-width for the combobox dropdown content. */
export const contentMinWidth = style({ minWidth: '11.25rem' }); // 180px

/** Anatomy composed with fieldControl() for input appearance. */
export const triggerInput = style({
  display: 'flex',
  alignItems: 'center',
  gap: '0.375rem',
});
