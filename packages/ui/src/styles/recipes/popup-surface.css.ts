/**
 * popupSurface — shared base style for floating popup containers.
 *
 * Encapsulates the properties that are identical across DropdownMenu, Select,
 * Combobox, and ComboboxPopup content panels: animation entry/exit keyframes
 * keyed to [data-open]/[data-closed] and [data-side], the ring shadow formula,
 * and core visual properties.
 *
 * Each primitive extends this by composing it into their own `style()`:
 *   export const menuContent = style([popupSurface, { overflowY: 'auto', ... }]);
 *
 * Variants in sizing (minWidth, overflowY, anchor-width usage) and shadow depth
 * are applied at the composing level, not here.
 */

import { style } from '@vanilla-extract/css';
import {
  kfPopupIn,
  kfPopupOut,
  kfPopupInSlideFromTop,
  kfPopupInSlideFromBottom,
  kfPopupInSlideFromLeft,
  kfPopupInSlideFromRight,
} from '@styles/effects/animations.css';
import { vars } from '@theme/core/contract/contract.css';

export const popupSurface = style({
  position: 'relative',
  zIndex: 50,
  transformOrigin: 'var(--transform-origin)',
  borderRadius: 'var(--radius-md)',
  backgroundColor: vars.surface,
  color: vars.foreground,
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
    '&[data-closed]': { animation: `${kfPopupOut} 100ms both` },
  },
});

/**
 * Shadow tokens for popup containers.
 * - ringSm: subtle ring + gentle shadow (combobox, tooltips)
 * - ringMd: deeper shadow (dropdown menus, selects)
 */
export const popupShadowSm = style({
  boxShadow: `0 1px 3px 0 rgba(0,0,0,0.1), 0 1px 2px -1px rgba(0,0,0,0.1), 0 0 0 1px color-mix(in srgb, ${vars.foreground} 10%, transparent)`,
});

export const popupShadowMd = style({
  boxShadow: `0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1), 0 0 0 1px color-mix(in srgb, ${vars.foreground} 10%, transparent)`,
});
