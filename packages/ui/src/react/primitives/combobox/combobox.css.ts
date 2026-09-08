import { tokens } from '@emdash/theme';
import { recipe, style } from '@styles/index';
import { iconSizeVar } from '@styles/recipes/icon-contract';
import { popup } from '@styles/recipes/popup';
import { popupVars } from '@styles/recipes/popup-contract';

export const positioner = style({
  isolation: 'isolate',
  zIndex: 50,
});

export const comboboxTrigger = style({
  vars: {
    [iconSizeVar]: '1rem',
  },
});

export const comboboxContent = style([
  popup(),
  {
    maxHeight: popupVars.availableHeight,
    maxWidth: popupVars.availableWidth,
    overflow: 'hidden',
    padding: '2px',
    selectors: {
      '&[data-width="trigger"]': {
        width: popupVars.anchorWidth,
        minWidth: popupVars.anchorWidth,
      },
      '&[data-width="content"]': {
        width: 'max-content',
        minWidth: '11.25rem',
      },
      '&[data-width="content-at-least-trigger"]': {
        width: 'max-content',
        minWidth: `max(11.25rem, ${popupVars.anchorWidth})`,
      },
    },
  },
]);

/** Outer wrapper that ScrollContainer renders — position context for the fade overlay. */
export const comboboxListScroller = style({});

/**
 * Applied to the scroll viewport inside ScrollContainer.
 * overscrollBehavior must be on the actual scrolling element.
 */
export const comboboxListViewport = style({
  overscrollBehavior: 'contain',
});

export const comboboxList = style({
  scrollPaddingTop: '2px',
  scrollPaddingBottom: '2px',
});

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
  fontSize: tokens.typography.size.xs,
  color: tokens.foreground.muted,
});

export const comboboxEmpty = style({
  display: 'none',
  width: '100%',
  justifyContent: 'center',
  paddingTop: '0.5rem',
  paddingBottom: '0.5rem',
  textAlign: 'center',
  fontSize: tokens.typography.size.sm,
  color: tokens.foreground.muted,
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
  backgroundColor: tokens.border.default,
});

export const comboboxChips = recipe({
  base: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.375rem',
    selectors: {
      '&:has([data-slot="combobox-chip"])': {
        paddingLeft: '0.375rem',
      },
    },
  },
  variants: {
    size: {
      base: {
        minHeight: '2.25rem',
        paddingTop: '0.375rem',
        paddingRight: '0.625rem',
        paddingBottom: '0.375rem',
        paddingLeft: '0.625rem',
        fontSize: tokens.typography.size.sm,
      },
      sm: {
        minHeight: '1.5rem',
        paddingTop: '0.25rem',
        paddingRight: '0.5rem',
        paddingBottom: '0.25rem',
        paddingLeft: '0.5rem',
        fontSize: tokens.typography.size.xs,
      },
    },
  },
  defaultVariants: {
    size: 'base',
  },
});

export const comboboxChip = style({
  display: 'flex',
  height: '1.375rem',
  width: 'fit-content',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.25rem',
  borderRadius: tokens.radius.sm,
  backgroundColor: tokens.surface.current.hover,
  paddingLeft: '0.375rem',
  paddingRight: '0.375rem',
  fontSize: tokens.typography.size.xs,
  fontWeight: 400,
  whiteSpace: 'nowrap',
  color: tokens.foreground.default,
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

/** Applied directly to the trigger button owned by `Combobox.Input`. */
export const triggerButton = style({
  selectors: {
    '&[data-pressed]': { backgroundColor: 'transparent' },
  },
});

export const triggerButtonHidden = style({
  display: 'none',
});
