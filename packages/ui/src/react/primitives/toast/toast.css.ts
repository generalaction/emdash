/**
 * Toast foreign-DOM Styling Adapter — restyles Sonner onto the Token contract.
 *
 * Sonner themes itself through CSS custom properties declared on
 * `[data-sonner-toaster][data-sonner-theme=…]` selectors and styles its
 * internals via data-attribute selectors on DOM it owns. Its only theming
 * hooks are those variables and CSS targeting those attributes, so the
 * overrides below are rooted Global Rules by necessity (this is third-party
 * DOM, not an @emdash/ui component boundary). This module is registered as a
 * Global Adapter; every selector is anchored on the doubled `toaster` class so
 * it outranks Sonner's injected stylesheet regardless of insertion order.
 */

import { tokens } from '@emdash/theme';
import { globalStyle } from '@styles/adapter';
import { style } from '@styles/index';
import { popupShadowValue } from '@styles/recipes/popup';

export const toaster = style({
  selectors: {
    // (0,3,0) — beats sonner's (0,2,0) theme-default variable declarations.
    '&&[data-sonner-toaster]': {
      fontFamily: tokens.typography.family.sans,
      vars: {
        '--normal-bg': tokens.palette.neutral.step1,
        '--normal-border': tokens.border.default,
        '--normal-text': tokens.foreground.default,
        '--border-radius': tokens.radius.md,
      },
    },
  },
});

const rootedToaster = `${toaster}${toaster}`;

globalStyle(`${rootedToaster}[data-sonner-toaster] [data-sonner-toast][data-styled='true']`, {
  boxShadow: popupShadowValue('md'),
  borderColor: 'transparent',
});

// Sonner hardcodes description colors per light/dark theme; own them instead.
globalStyle(
  `${rootedToaster}[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-description]`,
  {
    color: tokens.foreground.muted,
  }
);

// Tone-colored status icons on an otherwise neutral surface.
const TONE_ICON_COLORS = {
  success: tokens.feedback.success.foreground,
  error: tokens.feedback.error.foreground,
  warning: tokens.feedback.warning.foreground,
  info: tokens.feedback.info.foreground,
} as const;

for (const [type, color] of Object.entries(TONE_ICON_COLORS)) {
  globalStyle(
    `${rootedToaster}[data-sonner-toaster] [data-sonner-toast][data-type='${type}'] [data-icon]`,
    { color }
  );
}

// Promise-toast loading spinner bars (sonner defaults them to its gray ramp).
globalStyle(`${rootedToaster}[data-sonner-toaster] .sonner-loading-bar`, {
  backgroundColor: tokens.foreground.muted,
});

// Action button reads as the primary button.
globalStyle(
  `${rootedToaster}[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-button]`,
  {
    backgroundColor: tokens.palette.accent.step9,
    color: tokens.palette.accent.contrast,
    cursor: 'pointer',
  }
);

globalStyle(
  `${rootedToaster}[data-sonner-toaster] [data-sonner-toast][data-styled='true'] [data-button]:hover`,
  {
    backgroundColor: tokens.palette.accent.step10,
  }
);
