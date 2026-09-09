import { tokens } from '@emdash/theme';
import { hostRecipe } from '@emdash/ui/styles/host';
import { DESKTOP_HOST_ROOT_SELECTOR } from '@core/primitives/styling/api/desktop-host-styles';

/**
 * Desktop VCS meanings intentionally kept out of the shared Theme Token tree.
 */
export const vcsState = hostRecipe({
  variants: {
    state: {
      open: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.feedback.success.foreground,
          },
        },
      },
      draft: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.foreground.muted,
          },
        },
      },
      merged: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.palette.purple.step9,
          },
        },
      },
      closed: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.feedback.error.foreground,
          },
        },
      },
      conflicted: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.palette.orange.step11,
          },
        },
      },
      completed: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.feedback.success.foreground,
          },
        },
      },
    },
  },
});
