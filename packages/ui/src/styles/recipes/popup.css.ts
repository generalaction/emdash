import { tokens } from '@emdash/theme';
import { recipe } from '@styles/index';
import { popupShadowValues, popupVars } from './popup-contract';
import {
  kfPopupIn,
  kfPopupInSlideFromBottom,
  kfPopupInSlideFromLeft,
  kfPopupInSlideFromRight,
  kfPopupInSlideFromTop,
  kfPopupOut,
} from '@styles/effects/animations.css';

export const popupRecipe = recipe({
  base: {
    zIndex: 50,
    outline: 'none',
    vars: {
      '--_popup-anchor-width': 'var(--anchor-width)',
      '--_popup-available-height': 'var(--available-height)',
      '--_popup-available-width': 'var(--available-width)',
      '--_popup-transform-origin': 'var(--transform-origin)',
    },
  },
  variants: {
    appearance: {
      surface: {},
      inverted: {
        backgroundColor: tokens.palette.neutral.step12,
        color: tokens.palette.neutral.step1,
      },
    },
    motion: {
      enter: {
        animation: `${kfPopupIn} 100ms both`,
      },
      none: {},
      positioned: {
        transformOrigin: popupVars.transformOrigin,
        selectors: {
          '&[data-open]': { animation: `${kfPopupIn} 100ms both` },
          '&[data-open][data-side="bottom"]': {
            animation: `${kfPopupInSlideFromTop} 100ms both`,
          },
          '&[data-open][data-side="top"]': {
            animation: `${kfPopupInSlideFromBottom} 100ms both`,
          },
          '&[data-open][data-side="right"]': {
            animation: `${kfPopupInSlideFromLeft} 100ms both`,
          },
          '&[data-open][data-side="inline-end"]': {
            animation: `${kfPopupInSlideFromLeft} 100ms both`,
          },
          '&[data-open][data-side="left"]': {
            animation: `${kfPopupInSlideFromRight} 100ms both`,
          },
          '&[data-open][data-side="inline-start"]': {
            animation: `${kfPopupInSlideFromRight} 100ms both`,
          },
          '&[data-closed]': { animation: `${kfPopupOut} 100ms both` },
        },
      },
      scale: {
        selectors: {
          '&[data-open]': { animation: `${kfPopupIn} 100ms both` },
          '&[data-closed]': { animation: `${kfPopupOut} 100ms both` },
        },
      },
    },
    radius: {
      none: { borderRadius: 0 },
      md: { borderRadius: tokens.radius.md },
      xl: { borderRadius: tokens.radius.xl },
    },
    shadow: {
      none: { boxShadow: popupShadowValues.none },
      'sm-plain': { boxShadow: popupShadowValues['sm-plain'] },
      sm: { boxShadow: popupShadowValues.sm },
      md: { boxShadow: popupShadowValues.md },
      lg: { boxShadow: popupShadowValues.lg },
      overlay: { boxShadow: popupShadowValues.overlay },
    },
    bordered: {
      true: { border: `1px solid ${tokens.border.default}` },
      false: {},
    },
  },
  defaultVariants: {
    appearance: 'surface',
    bordered: false,
    motion: 'positioned',
    radius: 'md',
    shadow: 'sm',
  },
});
