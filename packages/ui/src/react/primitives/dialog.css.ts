import { recipe } from '@vanilla-extract/recipes';
import { style } from '@vanilla-extract/css';
import { vars } from '../../theme/core/contract/contract.css';
import { kfFadeIn, kfFadeOut, kfPopupIn, kfPopupOut } from '../../styles/animations.css';

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

export const content = recipe({
  base: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    zIndex: 50,
    display: 'flex',
    maxHeight: 'calc(100dvh - 2rem)',
    width: '100%',
    maxWidth: 'calc(100% - 2rem)',
    transform: 'translateX(-50%) translateY(-50%)',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 'var(--radius-xl)',
    backgroundColor: vars.surface,
    fontSize: 'var(--text-sm)',
    color: vars.foreground,
    boxShadow: `0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1), 0 0 0 1px color-mix(in srgb, ${vars.foreground} 10%, transparent)`,
    outline: 'none',
    selectors: {
      '&[data-open]': { animation: `${kfPopupIn} 100ms both` },
      '&[data-closed]': { animation: `${kfPopupOut} 100ms both` },
    },
  },
  variants: {
    size: {
      xs: { '@media': { 'screen and (min-width: 640px)': { maxWidth: '20rem' } } },
      sm: { '@media': { 'screen and (min-width: 640px)': { maxWidth: '24rem' } } },
      md: { '@media': { 'screen and (min-width: 640px)': { maxWidth: '32rem' } } },
      lg: { '@media': { 'screen and (min-width: 640px)': { maxWidth: '42rem' } } },
      xl: { '@media': { 'screen and (min-width: 640px)': { maxWidth: '80vw', height: '80vh' } } },
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
  borderTop: `1px solid ${vars.border}`,
  padding: '0.75rem',
  backgroundColor: vars.surfaceBaseEmphasis,
  '@media': {
    '(min-width: 640px)': {
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
  },
});

export const title = style({
  fontSize: 'var(--text-sm)',
  letterSpacing: '-0.015em',
  color: vars.foreground,
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
  color: vars.foregroundMuted,
  selectors: {
    '&:hover': { color: vars.foreground },
  },
});
