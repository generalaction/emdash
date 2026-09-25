import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';
import { popup } from '@styles/recipes/popup';
import {
  kfFadeIn,
  kfFadeOut,
  kfSlideInFromRight,
  kfSlideInFromLeft,
  kfSlideInFromTop,
  kfSlideInFromBottom,
  kfSlideOutToRight,
  kfSlideOutToLeft,
  kfSlideOutToTop,
  kfSlideOutToBottom,
} from '@styles/effects/animations.css';

const noDragRegion = { WebkitAppRegion: 'no-drag' } as Record<string, string>;

export const backdrop = style({
  ...noDragRegion,
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
  base: [
    popup({ level: 'base', motion: 'none', radius: 'none', shadow: 'lg' }),
    {
      ...noDragRegion,
      position: 'fixed',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      fontSize: tokens.typography.size.sm,
    },
  ],
  variants: {
    side: {
      right: {
        top: 0,
        bottom: 0,
        right: 0,
        height: '100%',
        width: '75%',
        '@media': {
          '(min-width: 640px)': { maxWidth: '36rem' },
        },
        selectors: {
          '&[data-open]': { animation: `${kfSlideInFromRight} 200ms both` },
          '&[data-closed]': { animation: `${kfSlideOutToRight} 200ms both` },
        },
      },
      left: {
        top: 0,
        bottom: 0,
        left: 0,
        height: '100%',
        width: '75%',
        '@media': {
          '(min-width: 640px)': { maxWidth: '28rem' },
        },
        selectors: {
          '&[data-open]': { animation: `${kfSlideInFromLeft} 200ms both` },
          '&[data-closed]': { animation: `${kfSlideOutToLeft} 200ms both` },
        },
      },
      top: {
        top: 0,
        left: 0,
        right: 0,
        width: '100%',
        maxHeight: '75%',
        selectors: {
          '&[data-open]': { animation: `${kfSlideInFromTop} 200ms both` },
          '&[data-closed]': { animation: `${kfSlideOutToTop} 200ms both` },
        },
      },
      bottom: {
        bottom: 0,
        left: 0,
        right: 0,
        width: '100%',
        maxHeight: '75%',
        selectors: {
          '&[data-open]': { animation: `${kfSlideInFromBottom} 200ms both` },
          '&[data-closed]': { animation: `${kfSlideOutToBottom} 200ms both` },
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
  fontSize: tokens.typography.size.sm,
  letterSpacing: '-0.015em',
  color: tokens.foreground.default,
});

export const sheetFooter = style({
  display: 'flex',
  flexShrink: 0,
  flexDirection: 'column-reverse',
  gap: '0.5rem',
  borderTop: `1px solid ${tokens.border.default}`,
  padding: '0.75rem',
  backgroundColor: tokens.surface.level.raised.background,
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
  color: tokens.foreground.muted,
  selectors: {
    '&:hover': { color: tokens.foreground.default },
  },
});
