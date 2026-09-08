import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

/** Container for a group of Toggle buttons. */
export const toggleGroup = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.125rem',
  borderRadius: tokens.radius.md,
  backgroundColor: tokens.surface.current.background,
  padding: '0.125rem',
});
