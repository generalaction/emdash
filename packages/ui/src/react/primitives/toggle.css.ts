import { style } from '@vanilla-extract/css';
import { vars } from '@theme/core/contract/contract.css';

/** Container for a group of Toggle buttons. */
export const toggleGroup = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.125rem',
  borderRadius: 'var(--radius-md)',
  backgroundColor: vars.surface,
  padding: '0.125rem',
});
