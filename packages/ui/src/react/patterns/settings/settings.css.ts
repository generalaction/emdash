import { tokens } from '@emdash/theme';
import { style } from '@styles/index';

export const card = style({
  display: 'flex',
  overflow: 'hidden',
  flexDirection: 'column',
  border: `1px solid ${tokens.surface.current.border}`,
  borderRadius: tokens.radius.lg,
  backgroundColor: tokens.surface.current.background,
  padding: '1rem',
  color: tokens.foreground.default,
});

export const body = style({
  display: 'flex',
  flexDirection: 'column',
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
});

// Aligns the heading with the card's inner content (card padding is 1rem).
export const sectionTitle = style({
  paddingInline: '1rem',
});
