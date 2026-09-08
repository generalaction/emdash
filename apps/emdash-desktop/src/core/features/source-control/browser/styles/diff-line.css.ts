import { tokens } from '@emdash/theme';
import { hostRecipe } from '@emdash/ui/styles/host';
import { DESKTOP_HOST_ROOT_SELECTOR } from '@core/primitives/styling/api/desktop-host-styles';

/**
 * Product-owned diff meanings expressed with canonical Palette Tokens.
 */
export const diffLine = hostRecipe({
  variants: {
    kind: {
      added: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.palette.green.step9,
          },
        },
      },
      modified: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.palette.amber.step9,
          },
        },
      },
      deleted: {
        selectors: {
          [`${DESKTOP_HOST_ROOT_SELECTOR} &`]: {
            color: tokens.palette.red.step9,
          },
        },
      },
    },
  },
});
