import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import {
  kfFadeIn,
  kfFadeOut,
  kfSlideInFromRight,
  kfSlideInFromLeft,
  kfSlideOutToRight,
  kfSlideOutToLeft,
} from '@styles/effects/animations.css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

export const backdrop = style({
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  backgroundColor: 'rgba(0,0,0,0.4)',
  selectors: {
    '&[data-open]': { animation: `${kfFadeIn} 150ms both` },
    '&[data-closed]': { animation: `${kfFadeOut} 150ms both` },
  },
});

export const sheetContent = recipe({
  base: {
    position: 'fixed',
    top: 0,
    bottom: 0,
    zIndex: 50,
    display: 'flex',
    height: '100%',
    width: '75%',
    flexDirection: 'column',
    overflow: 'hidden',
    fontSize: tokenVars.textSm,
    color: vars.foreground,
    backgroundColor: vars.surface,
    boxShadow: `0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1), 0 0 0 1px color-mix(in srgb, ${vars.foreground} 10%, transparent)`,
    outline: 'none',
  },
  variants: {
    side: {
      right: {
        right: 0,
        '@media': {
          '(min-width: 640px)': { maxWidth: '36rem' },
        },
        selectors: {
          '&[data-open]': { animation: `${kfSlideInFromRight} 200ms both` },
          '&[data-closed]': { animation: `${kfSlideOutToRight} 200ms both` },
        },
      },
      left: {
        left: 0,
        '@media': {
          '(min-width: 640px)': { maxWidth: '28rem' },
        },
        selectors: {
          '&[data-open]': { animation: `${kfSlideInFromLeft} 200ms both` },
          '&[data-closed]': { animation: `${kfSlideOutToLeft} 200ms both` },
        },
      },
    },
  },
  defaultVariants: { side: 'right' },
});

export const sheetHeader = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '1rem',
});

export const sheetHeaderInner = style({
  display: 'flex',
  minWidth: 0,
  flexDirection: 'column',
  gap: '0.25rem',
});

export const sheetTitle = style({
  fontSize: tokenVars.textSm,
  letterSpacing: '-0.015em',
  color: vars.foreground,
});

export const sheetFooter = style({
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

export const sheetBody = style({
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
