import { globalStyle, style } from '@vanilla-extract/css';
import {
  kfPopupIn,
  kfPopupOut,
  kfPopupInSlideFromTop,
  kfPopupInSlideFromBottom,
  kfPopupInSlideFromLeft,
  kfPopupInSlideFromRight,
} from '@styles/effects/animations.css';
import { vars } from '@theme/core/contract/contract.css';
import { tokenVars } from '@theme/tokens.css';

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
  borderRadius: tokenVars.radiusMd,
  backgroundColor: vars.surface,
  padding: '0.25rem',
  color: vars.foreground,
  boxShadow: `${vars.shadowMd}, 0 0 0 1px color-mix(in srgb, ${vars.foreground} 10%, transparent)`,
  outline: 'none',
  selectors: {
    '&[data-open]': { animation: `${kfPopupIn} 100ms both` },
    '&[data-open][data-side="bottom"]': { animation: `${kfPopupInSlideFromTop} 100ms both` },
    '&[data-open][data-side="top"]': { animation: `${kfPopupInSlideFromBottom} 100ms both` },
    '&[data-open][data-side="right"]': { animation: `${kfPopupInSlideFromLeft} 100ms both` },
    '&[data-open][data-side="inline-end"]': { animation: `${kfPopupInSlideFromLeft} 100ms both` },
    '&[data-open][data-side="left"]': { animation: `${kfPopupInSlideFromRight} 100ms both` },
    '&[data-open][data-side="inline-start"]': {
      animation: `${kfPopupInSlideFromRight} 100ms both`,
    },
    '&[data-closed]': { animation: `${kfPopupOut} 100ms both`, overflow: 'hidden' },
  },
});

export const menuLabel = style({
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: tokenVars.textXs,
  fontWeight: 400,
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
  borderRadius: tokenVars.radiusSm,
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: tokenVars.textSm,
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
  borderRadius: tokenVars.radiusSm,
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: tokenVars.textSm,
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
  borderRadius: tokenVars.radiusSm,
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  paddingRight: '2rem',
  paddingLeft: '0.5rem',
  fontSize: tokenVars.textSm,
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
  borderRadius: tokenVars.radiusSm,
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  paddingRight: '2rem',
  paddingLeft: '0.5rem',
  fontSize: tokenVars.textSm,
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

/** Overrides the default anchor-width sizing for sub-menus so they size to content. */
export const subContentOverride = style({
  width: 'auto',
  minWidth: '6rem', // 96px
});

export const menuShortcut = style({
  marginLeft: 'auto',
  fontSize: tokenVars.textXs,
  letterSpacing: '0.1em',
  color: vars.foregroundMuted,
  // When the parent menu item is focused, shortcut adapts to foreground color
  selectors: {
    '[data-slot="dropdown-menu-item"]:focus &': { color: vars.foreground },
  },
});
