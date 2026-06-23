import { globalStyle, style } from '@vanilla-extract/css';
import {
  kfPopupIn,
  kfPopupOut,
  kfPopupInSlideFromTop,
  kfPopupInSlideFromBottom,
  kfPopupInSlideFromLeft,
  kfPopupInSlideFromRight,
} from '@styles/animations.css';
import { vars } from '@theme/core/contract/contract.css';

export const positioner = style({
  isolation: 'isolate',
  zIndex: 50,
});

export const selectGroup = style({
  scrollMarginTop: '0.25rem',
  scrollMarginBottom: '0.25rem',
  padding: '0.25rem',
});

export const selectValue = style({
  display: 'flex',
  flex: 1,
  textAlign: 'left',
});

export const selectContent = style({
  position: 'relative',
  isolation: 'isolate',
  zIndex: 50,
  maxHeight: 'var(--available-height)',
  width: 'var(--anchor-width)',
  minWidth: '9rem',
  transformOrigin: 'var(--transform-origin)',
  overflowX: 'hidden',
  overflowY: 'auto',
  borderRadius: 'var(--radius-md)',
  backgroundColor: vars.surface,
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
    '&[data-open][data-side="inline-start"]': {
      animation: `${kfPopupInSlideFromRight} 100ms both`,
    },
    // When aligned with trigger, skip the popup animation
    '&[data-align-trigger="true"]': { animation: 'none' },
    '&[data-closed]': { animation: `${kfPopupOut} 100ms both` },
  },
});

export const selectLabel = style({
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: 'var(--text-xs)',
  color: vars.foregroundMuted,
});

export const selectItem = style({
  position: 'relative',
  display: 'flex',
  width: '100%',
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
  selectors: {
    '&:focus': { backgroundColor: vars.surfaceHover, color: vars.foreground },
    '&[data-disabled]': { pointerEvents: 'none', opacity: 0.5 },
  },
});
globalStyle(`${selectItem} svg`, { pointerEvents: 'none', flexShrink: 0 });
globalStyle(`${selectItem} svg:not([class*='size-'])`, { width: '1rem', height: '1rem' });

export const selectItemText = style({
  display: 'flex',
  minWidth: 0,
  flex: 1,
  alignItems: 'center',
  gap: '0.5rem',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});

export const selectItemIndicator = style({
  pointerEvents: 'none',
  position: 'absolute',
  right: '0.5rem',
  display: 'flex',
  width: '1rem',
  height: '1rem',
  alignItems: 'center',
  justifyContent: 'center',
});

export const selectSeparator = style({
  pointerEvents: 'none',
  marginLeft: '-0.25rem',
  marginRight: '-0.25rem',
  marginTop: '0.25rem',
  marginBottom: '0.25rem',
  height: '1px',
  backgroundColor: vars.border,
});

export const scrollButton = style({
  zIndex: 10,
  display: 'flex',
  width: '100%',
  cursor: 'default',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: vars.surface,
  paddingTop: '0.25rem',
  paddingBottom: '0.25rem',
});
globalStyle(`${scrollButton} svg:not([class*='size-'])`, { width: '1rem', height: '1rem' });

export const triggerInvalidOverride = style({
  selectors: {
    '&[aria-invalid="true"]': {
      borderColor: vars.borderDestructive,
      boxShadow: `0 0 0 3px color-mix(in srgb, ${vars.borderDestructive} 20%, transparent)`,
    },
  },
});
