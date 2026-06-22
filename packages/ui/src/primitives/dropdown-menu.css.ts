import { globalStyle, style } from '@vanilla-extract/css';
import { vars } from '../theme/contract/contract.css';
import {
  kfPopupIn,
  kfPopupOut,
  kfPopupInSlideFromTop,
  kfPopupInSlideFromBottom,
  kfPopupInSlideFromLeft,
  kfPopupInSlideFromRight,
} from '../theme/animations.css';

export const positioner = style({
  isolation: 'isolate',
  zIndex: 50,
  outline: 'none',
});

export const menuContent = style({
  zIndex: 50,
  maxHeight: 'var(--available-height)',
  width: 'var(--anchor-width)',
  minWidth: '12rem',
  transformOrigin: 'var(--transform-origin)',
  overflowX: 'hidden',
  overflowY: 'auto',
  borderRadius: 'var(--radius-md)',
  backgroundColor: vars.surface,
  padding: '0.25rem',
  color: vars.foreground,
  boxShadow: `0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1), 0 0 0 1px color-mix(in srgb, ${vars.foreground} 10%, transparent)`,
  outline: 'none',
  selectors: {
    '&[data-open]': { animation: `${kfPopupIn} 100ms both` },
    '&[data-open][data-side="bottom"]': { animation: `${kfPopupInSlideFromTop} 100ms both` },
    '&[data-open][data-side="top"]': { animation: `${kfPopupInSlideFromBottom} 100ms both` },
    '&[data-open][data-side="right"]': { animation: `${kfPopupInSlideFromLeft} 100ms both` },
    '&[data-open][data-side="inline-end"]': { animation: `${kfPopupInSlideFromLeft} 100ms both` },
    '&[data-open][data-side="left"]': { animation: `${kfPopupInSlideFromRight} 100ms both` },
    '&[data-open][data-side="inline-start"]': { animation: `${kfPopupInSlideFromRight} 100ms both` },
    '&[data-closed]': { animation: `${kfPopupOut} 100ms both`, overflow: 'hidden' },
  },
});

export const menuLabel = style({
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  color: vars.foregroundMuted,
  selectors: {
    '&[data-inset]': { paddingLeft: '2rem' },
  },
});

export const menuItem = style({
  position: 'relative',
  display: 'flex',
  cursor: 'default',
  alignItems: 'center',
  gap: '0.5rem',
  borderRadius: 'var(--radius-sm)',
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: 'var(--text-sm)',
  outline: 'none',
  userSelect: 'none',
  selectors: {
    '&:focus': { backgroundColor: vars.surfaceHover, color: vars.foreground },
    '&[data-inset]': { paddingLeft: '2rem' },
    '&[data-variant="destructive"]': { color: vars.foregroundDestructive },
    '&[data-variant="destructive"]:focus': {
      backgroundColor: vars.backgroundDestructive,
      color: vars.foregroundDestructive,
    },
    '&[data-disabled]': { pointerEvents: 'none', opacity: 0.5 },
  },
});
globalStyle(`${menuItem} svg`, { pointerEvents: 'none', flexShrink: 0 });
globalStyle(`${menuItem} svg:not([class*='size-'])`, { width: '1rem', height: '1rem' });

export const menuSubTrigger = style({
  display: 'flex',
  cursor: 'default',
  alignItems: 'center',
  gap: '0.5rem',
  borderRadius: 'var(--radius-sm)',
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: 'var(--text-sm)',
  outline: 'none',
  userSelect: 'none',
  selectors: {
    '&:focus': { backgroundColor: vars.surfaceHover, color: vars.foreground },
    '&[data-inset]': { paddingLeft: '2rem' },
    '&[data-popup-open]': { backgroundColor: vars.surfaceHover, color: vars.foreground },
    '&[data-open]': { backgroundColor: vars.surfaceHover, color: vars.foreground },
  },
});
globalStyle(`${menuSubTrigger} svg`, { pointerEvents: 'none', flexShrink: 0 });
globalStyle(`${menuSubTrigger} svg:not([class*='size-'])`, { width: '1rem', height: '1rem' });

export const menuCheckboxItem = style({
  position: 'relative',
  display: 'flex',
  cursor: 'default',
  alignItems: 'center',
  gap: '0.5rem',
  borderRadius: 'var(--radius-sm)',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  paddingRight: '2rem',
  paddingLeft: '0.5rem',
  fontSize: 'var(--text-sm)',
  outline: 'none',
  userSelect: 'none',
  color: vars.foregroundMuted,
  selectors: {
    '&[data-checked]': { color: vars.foreground, backgroundColor: vars.surfaceSelected },
    '&:focus': { backgroundColor: vars.surfaceHover, color: vars.foreground },
    '&[data-inset]': { paddingLeft: '2rem' },
    '&[data-disabled]': { pointerEvents: 'none', opacity: 0.5 },
  },
});
globalStyle(`${menuCheckboxItem} svg`, { pointerEvents: 'none', flexShrink: 0 });
globalStyle(`${menuCheckboxItem} svg:not([class*='size-'])`, { width: '1rem', height: '1rem' });

export const menuRadioItem = style({
  position: 'relative',
  display: 'flex',
  cursor: 'default',
  alignItems: 'center',
  gap: '0.5rem',
  borderRadius: 'var(--radius-sm)',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  paddingRight: '2rem',
  paddingLeft: '0.5rem',
  fontSize: 'var(--text-sm)',
  outline: 'none',
  userSelect: 'none',
  color: vars.foregroundMuted,
  selectors: {
    '&[data-checked]': { color: vars.foreground, backgroundColor: vars.surfaceSelected },
    '&:focus': { backgroundColor: vars.surfaceHover, color: vars.foreground },
    '&[data-inset]': { paddingLeft: '2rem' },
    '&[data-disabled]': { pointerEvents: 'none', opacity: 0.5 },
  },
});
globalStyle(`${menuRadioItem} svg`, { pointerEvents: 'none', flexShrink: 0 });
globalStyle(`${menuRadioItem} svg:not([class*='size-'])`, { width: '1rem', height: '1rem' });

export const menuItemIndicator = style({
  pointerEvents: 'none',
  position: 'absolute',
  right: '0.5rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const menuSeparator = style({
  marginLeft: '-0.25rem',
  marginRight: '-0.25rem',
  marginTop: '0.25rem',
  marginBottom: '0.25rem',
  height: '1px',
  backgroundColor: vars.border,
});

export const menuShortcut = style({
  marginLeft: 'auto',
  fontSize: 'var(--text-xs)',
  letterSpacing: '0.1em',
  color: vars.foregroundMuted,
  // When the parent menu item is focused, shortcut adapts to foreground color
  selectors: {
    '[data-slot="dropdown-menu-item"]:focus &': { color: vars.foreground },
  },
});
