import { tokens } from '@emdash/theme';
import { hostRecipe } from '@emdash/ui/styles/host';
import { DESKTOP_HOST_ROOT_SELECTOR } from '@core/primitives/styling/api/desktop-host-styles';

/**
 * Workflow meanings owned by the task domain rather than the shared Theme.
 */
export const workflowStatus = hostRecipe({
  variants: {
    status: {
      'in-progress': {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.feedback.warning.foreground,
          },
        },
      },
      'in-review': {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.palette.green.step10,
          },
        },
      },
      done: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.foreground.passive,
          },
        },
      },
      todo: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.foreground.passive,
          },
        },
      },
      cancelled: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.foreground.passive,
          },
        },
      },
    },
  },
});
