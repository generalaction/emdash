import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';
import { popup } from '@styles/recipes/popup';
import { kfFadeIn, kfFadeOut } from '@styles/effects/animations.css';

export const overlay = style({
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  backgroundColor: 'rgba(0,0,0,0.4)',
  selectors: {
    '&[data-open]': { animation: `${kfFadeIn} 100ms both` },
    '&[data-closed]': { animation: `${kfFadeOut} 100ms both` },
  },
});

/** Full-viewport grid that centers the popup without using transform on the popup itself. */
export const positioner = style({
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  display: 'grid',
  placeItems: 'center',
  padding: '1rem',
  pointerEvents: 'none',
});

export const content = recipe({
  base: [
    popup({ motion: 'scale', radius: 'xl', shadow: 'overlay' }),
    {
      pointerEvents: 'auto',
      display: 'flex',
      maxHeight: '100%',
      width: '100%',
      maxWidth: '100%',
      flexDirection: 'column',
      overflow: 'hidden',
      fontSize: tokens.typography.size.sm,
    },
  ],
  variants: {
    size: {
      xs: { '@media': { 'screen and (min-width: 640px)': { maxWidth: '20rem' } } },
      sm: { '@media': { 'screen and (min-width: 640px)': { maxWidth: '24rem' } } },
      md: { '@media': { 'screen and (min-width: 640px)': { maxWidth: '32rem' } } },
      lg: { '@media': { 'screen and (min-width: 640px)': { maxWidth: '42rem' } } },
      xl: { '@media': { 'screen and (min-width: 640px)': { maxWidth: '80vw', height: '80vh' } } },
      // Near-fullscreen: fills the positioner (viewport minus its 1rem padding).
      full: { height: '100%' },
    },
  },
  defaultVariants: { size: 'md' },
});

export const header = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '1rem',
});

export const headerInner = style({
  display: 'flex',
  minWidth: 0,
  flexDirection: 'column',
  gap: '0.25rem',
});

export const footer = style({
  display: 'flex',
  flexShrink: 0,
  flexDirection: 'column-reverse',
  gap: '0.5rem',
  borderTop: `1px solid ${tokens.border.default}`,
  padding: '0.75rem',
  backgroundColor: tokens.surface.current.emphasis,
  '@media': {
    '(min-width: 640px)': {
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
  },
});

export const title = style({
  fontSize: tokens.typography.size.sm,
  letterSpacing: '-0.015em',
  color: tokens.foreground.default,
});

export const description = style({
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.muted,
});

export const descriptionLink = style({
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
  color: 'inherit',
  selectors: {
    '&:hover': { color: tokens.foreground.default },
  },
});

export const body = style({
  display: 'flex',
  width: '100%',
  flexDirection: 'column',
  gap: '0.5rem',
  padding: '1rem',
  paddingTop: 0,
  outline: 'none',
  selectors: {
    '&:focus-visible': { outline: 'none' },
  },
});

export const closeButtonOverride = style({
  marginTop: '-0.25rem',
  marginRight: '-0.25rem',
  flexShrink: 0,
  color: tokens.foreground.muted,
  selectors: {
    '&:hover': { color: tokens.foreground.default },
  },
});
