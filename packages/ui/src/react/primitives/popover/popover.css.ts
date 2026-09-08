import { tokens } from '@emdash/theme';
import { style } from '@styles/index';
import { popup } from '@styles/recipes/popup';

export const positioner = style({
  isolation: 'isolate',
  zIndex: 50,
});

export const popupContent = style([
  popup({ bordered: true, shadow: 'sm-plain' }),
  {
    display: 'flex',
    overflow: 'hidden',
    flexDirection: 'column',
    gap: '1rem',
    padding: '1rem',
    fontSize: tokens.typography.size.sm,
  },
]);

export const popoverHeader = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: tokens.typography.size.sm,
});

export const popoverTitle = style({
  fontWeight: 400,
});

export const popoverDescription = style({
  color: tokens.foreground.muted,
});
