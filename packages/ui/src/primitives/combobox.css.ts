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
});

export const comboboxTrigger = style({});
globalStyle(`${comboboxTrigger} svg:not([class*='size-'])`, { width: '1rem', height: '1rem' });

export const comboboxContent = style({
  position: 'relative',
  maxHeight: 'var(--available-height)',
  width: 'var(--anchor-width)',
  maxWidth: 'var(--available-width)',
  minWidth: 'var(--anchor-width)',
  transformOrigin: 'var(--transform-origin)',
  overflow: 'hidden',
  borderRadius: 'var(--radius-md)',
  backgroundColor: vars.surface,
  color: vars.foreground,
  boxShadow: `0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1), 0 0 0 1px color-mix(in srgb, ${vars.foreground} 10%, transparent)`,
  outline: 'none',
  selectors: {
    '&[data-open]': { animation: `${kfPopupIn} 100ms both` },
    '&[data-open][data-side="bottom"]': { animation: `${kfPopupInSlideFromTop} 100ms both` },
    '&[data-open][data-side="top"]': { animation: `${kfPopupInSlideFromBottom} 100ms both` },
    '&[data-open][data-side="right"]': { animation: `${kfPopupInSlideFromLeft} 100ms both` },
    '&[data-open][data-side="inline-end"]': { animation: `${kfPopupInSlideFromLeft} 100ms both` },
    '&[data-open][data-side="left"]': { animation: `${kfPopupInSlideFromRight} 100ms both` },
    '&[data-open][data-side="inline-start"]': { animation: `${kfPopupInSlideFromRight} 100ms both` },
    '&[data-closed]': { animation: `${kfPopupOut} 100ms both` },
  },
});
// Embedded input-group styling (child selectors must use globalStyle)
globalStyle(`${comboboxContent} [data-slot="input-group"]`, {
  margin: 0,
  height: '2.25rem',
  borderTop: 'none',
  borderLeft: 'none',
  borderRight: 'none',
  borderBottom: `1px solid ${vars.border}`,
  borderRadius: 0,
  backgroundColor: 'transparent',
  boxShadow: 'none',
});
globalStyle(`${comboboxContent} [data-slot="input-group"]:focus-within`, {
  boxShadow: 'none',
  borderColor: 'inherit',
});

export const comboboxList = style({
  maxHeight: 'min(18rem, calc(var(--available-height) - 2.25rem))',
  scrollPaddingTop: '0.25rem',
  scrollPaddingBottom: '0.25rem',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  padding: '0.25rem',
  selectors: {
    '&[data-empty]': { padding: 0 },
  },
});

export const comboboxItem = style({
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
    '&[data-highlighted]:not([data-selected])': { backgroundColor: vars.surfaceHover },
    '&[data-selected]': { backgroundColor: vars.surfaceSelected },
    '&[data-highlighted]': { color: vars.foreground },
    '&[data-disabled]': { pointerEvents: 'none', opacity: 0.5 },
  },
});
globalStyle(`${comboboxItem} svg`, { pointerEvents: 'none', flexShrink: 0 });
globalStyle(`${comboboxItem} svg:not([class*='size-'])`, { width: '1rem', height: '1rem' });

export const comboboxItemIndicator = style({
  pointerEvents: 'none',
  position: 'absolute',
  right: '0.5rem',
  display: 'flex',
  width: '0.875rem',
  height: '0.875rem',
  alignItems: 'center',
  justifyContent: 'center',
});

export const comboboxLabel = style({
  paddingLeft: '0.5rem',
  paddingRight: '0.5rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: 'var(--text-xs)',
  color: vars.foregroundMuted,
});

export const comboboxEmpty = style({
  display: 'none',
  width: '100%',
  justifyContent: 'center',
  paddingTop: '0.5rem',
  paddingBottom: '0.5rem',
  textAlign: 'center',
  fontSize: 'var(--text-sm)',
  color: vars.foregroundMuted,
  selectors: {
    // show when data-empty is on the parent popup
    '[data-slot="combobox-content"][data-empty] &': {
      display: 'flex',
    },
  },
});

export const comboboxSeparator = style({
  marginLeft: '-0.25rem',
  marginRight: '-0.25rem',
  marginTop: '0.25rem',
  marginBottom: '0.25rem',
  height: '1px',
  backgroundColor: vars.border,
});

export const comboboxChips = style({
  display: 'flex',
  minHeight: '2.25rem',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.375rem',
  borderRadius: 'var(--radius-md)',
  border: `1px solid ${vars.border}`,
  backgroundColor: 'transparent',
  backgroundClip: 'padding-box',
  paddingLeft: '0.625rem',
  paddingRight: '0.625rem',
  paddingTop: '0.375rem',
  paddingBottom: '0.375rem',
  fontSize: 'var(--text-sm)',
  boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)',
  transition: 'color 150ms, box-shadow 150ms',
  selectors: {
    '&:focus-within': {
      borderColor: vars.borderPrimary,
      boxShadow: `0 0 0 3px color-mix(in srgb, ${vars.borderPrimary} 30%, transparent)`,
    },
    '&:has([aria-invalid="true"])': {
      borderColor: vars.borderDestructive,
      boxShadow: `0 0 0 3px color-mix(in srgb, ${vars.borderDestructive} 20%, transparent)`,
    },
    '&:has([data-slot="combobox-chip"])': {
      paddingLeft: '0.375rem',
    },
  },
});

export const comboboxChip = style({
  display: 'flex',
  height: '1.375rem',
  width: 'fit-content',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.25rem',
  borderRadius: 'var(--radius-sm)',
  backgroundColor: vars.surfaceHover,
  paddingLeft: '0.375rem',
  paddingRight: '0.375rem',
  fontSize: 'var(--text-xs)',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  color: vars.foreground,
  selectors: {
    '&:has([disabled])': { pointerEvents: 'none', cursor: 'not-allowed', opacity: 0.5 },
    '&:has([data-slot="combobox-chip-remove"])': { paddingRight: 0 },
  },
});

export const comboboxChipRemove = style({
  marginLeft: '-0.25rem',
  opacity: 0.5,
  selectors: {
    '&:hover': { opacity: 1 },
  },
});

export const comboboxChipsInput = style({
  minWidth: '4rem',
  flex: 1,
  outline: 'none',
});

export const inputGroupNoRing = style({
  selectors: {
    '&:has([data-slot="input-group-control"]:focus-visible)': {
      boxShadow: 'none',
      borderColor: vars.border,
    },
  },
});
