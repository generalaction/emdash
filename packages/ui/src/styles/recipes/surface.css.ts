/**
 * Establishes a Surface's inherited visual context and paints its root.
 *
 * Select at least one orthogonal axis:
 * - `level`: absolute elevation (`sunken`, `base`, `raised`, `elevated`, `overlay`)
 * - `role`: semantic purpose independent of elevation (`paper`)
 * - `tone`: neutral-status intent within the selected context
 * - `emphasis`: the surrounding Surface's context-relative emphasis
 *
 * Omitted axes inherit. The returned class belongs on the rendered region that
 * owns the Surface; use `className` separately for caller-owned layout.
 */

import { tokens } from '@emdash/theme';
import { recipe } from '@styles/index';
import { surfaceToneBindings, surfaceToneContext } from './surface-tone-context';

const inputColor = `color-mix(in srgb, ${tokens.surface.current.background} 94%, ${tokens.foreground.default})`;

export const surfaceRecipe = recipe({
  base: {
    backgroundColor: tokens.surface.current.background,
    color: tokens.surface.current.foreground,
  },

  variants: {
    level: {
      // Sunken — recessed, below the base plane (sidebars, trays)
      sunken: {
        vars: {
          [tokens.surface.current.background]: tokens.surface.level.sunken.background,
          [tokens.surface.current.hover]: tokens.surface.level.sunken.hover,
          [tokens.surface.current.selected]: tokens.surface.level.sunken.selected,
          [tokens.surface.current.emphasis]: tokens.surface.level.base.background,
          [tokens.surface.current.emphasisHover]: tokens.surface.level.base.hover,
          [tokens.surface.current.emphasisSelected]: tokens.surface.level.base.selected,
          [tokens.surface.current.input]: inputColor,
          ...surfaceToneBindings.sunken,
        },
      },
      // Base — default surface level (content areas, cards on sunken canvas)
      base: {
        vars: {
          [tokens.surface.current.background]: tokens.surface.level.base.background,
          [tokens.surface.current.hover]: tokens.surface.level.base.hover,
          [tokens.surface.current.selected]: tokens.surface.level.base.selected,
          [tokens.surface.current.emphasis]: tokens.surface.level.raised.background,
          [tokens.surface.current.emphasisHover]: tokens.surface.level.raised.hover,
          [tokens.surface.current.emphasisSelected]: tokens.surface.level.raised.selected,
          [tokens.surface.current.input]: inputColor,
          ...surfaceToneBindings.base,
        },
      },
      // Raised — context-relative emphasis above the base plane
      raised: {
        vars: {
          [tokens.surface.current.background]: tokens.surface.level.raised.background,
          [tokens.surface.current.hover]: tokens.surface.level.raised.hover,
          [tokens.surface.current.selected]: tokens.surface.level.raised.selected,
          [tokens.surface.current.emphasis]: tokens.surface.level.elevated.background,
          [tokens.surface.current.emphasisHover]: tokens.surface.level.elevated.hover,
          [tokens.surface.current.emphasisSelected]: tokens.surface.level.elevated.selected,
          [tokens.surface.current.input]: inputColor,
          ...surfaceToneBindings.raised,
        },
      },
      // Elevated — raised above base (popovers, dialogs, dropdowns)
      elevated: {
        vars: {
          [tokens.surface.current.background]: tokens.surface.level.elevated.background,
          [tokens.surface.current.hover]: tokens.surface.level.elevated.hover,
          [tokens.surface.current.selected]: tokens.surface.level.elevated.selected,
          [tokens.surface.current.emphasis]: tokens.surface.level.overlay.background,
          [tokens.surface.current.emphasisHover]: tokens.surface.level.overlay.hover,
          [tokens.surface.current.emphasisSelected]: tokens.surface.level.overlay.selected,
          [tokens.surface.current.input]: inputColor,
          ...surfaceToneBindings.elevated,
        },
      },
      // Overlay — top of the elevation ladder, clamped to itself
      overlay: {
        vars: {
          [tokens.surface.current.background]: tokens.surface.level.overlay.background,
          [tokens.surface.current.hover]: tokens.surface.level.overlay.hover,
          [tokens.surface.current.selected]: tokens.surface.level.overlay.selected,
          [tokens.surface.current.emphasis]: tokens.surface.level.overlay.background,
          [tokens.surface.current.emphasisHover]: tokens.surface.level.overlay.hover,
          [tokens.surface.current.emphasisSelected]: tokens.surface.level.overlay.selected,
          [tokens.surface.current.input]: inputColor,
          ...surfaceToneBindings.overlay,
        },
      },
    },

    role: {
      paper: {
        vars: {
          [tokens.surface.current.background]: tokens.surface.role.paper.background,
          [tokens.surface.current.hover]: tokens.surface.role.paper.hover,
          [tokens.surface.current.selected]: tokens.surface.role.paper.selected,
          [tokens.surface.current.emphasis]: tokens.surface.level.raised.background,
          [tokens.surface.current.emphasisHover]: tokens.surface.level.raised.hover,
          [tokens.surface.current.emphasisSelected]: tokens.surface.level.raised.selected,
          [tokens.surface.current.input]: inputColor,
          ...surfaceToneBindings.paper,
        },
      },
    },

    tone: {
      destructive: {
        vars: {
          [tokens.surface.current.background]: surfaceToneContext.destructive.background,
          [tokens.surface.current.foreground]: surfaceToneContext.destructive.foreground,
          [tokens.surface.current.border]: surfaceToneContext.destructive.border,
          [tokens.surface.current.hover]: surfaceToneContext.destructive.hover,
          [tokens.surface.current.selected]: surfaceToneContext.destructive.selected,
          [tokens.surface.current.emphasis]: surfaceToneContext.destructive.selected,
          [tokens.surface.current.emphasisHover]: surfaceToneContext.destructive.selected,
          [tokens.surface.current.emphasisSelected]: surfaceToneContext.destructive.selected,
          [tokens.surface.current.input]: inputColor,
        },
      },
      warning: {
        vars: {
          [tokens.surface.current.background]: surfaceToneContext.warning.background,
          [tokens.surface.current.foreground]: surfaceToneContext.warning.foreground,
          [tokens.surface.current.border]: surfaceToneContext.warning.border,
          [tokens.surface.current.hover]: surfaceToneContext.warning.hover,
          [tokens.surface.current.selected]: surfaceToneContext.warning.selected,
          [tokens.surface.current.emphasis]: surfaceToneContext.warning.selected,
          [tokens.surface.current.emphasisHover]: surfaceToneContext.warning.selected,
          [tokens.surface.current.emphasisSelected]: surfaceToneContext.warning.selected,
          [tokens.surface.current.input]: inputColor,
        },
      },
      info: {
        vars: {
          [tokens.surface.current.background]: surfaceToneContext.info.background,
          [tokens.surface.current.foreground]: surfaceToneContext.info.foreground,
          [tokens.surface.current.border]: surfaceToneContext.info.border,
          [tokens.surface.current.hover]: surfaceToneContext.info.hover,
          [tokens.surface.current.selected]: surfaceToneContext.info.selected,
          [tokens.surface.current.emphasis]: surfaceToneContext.info.selected,
          [tokens.surface.current.emphasisHover]: surfaceToneContext.info.selected,
          [tokens.surface.current.emphasisSelected]: surfaceToneContext.info.selected,
          [tokens.surface.current.input]: inputColor,
        },
      },
      success: {
        vars: {
          [tokens.surface.current.background]: surfaceToneContext.success.background,
          [tokens.surface.current.foreground]: surfaceToneContext.success.foreground,
          [tokens.surface.current.border]: surfaceToneContext.success.border,
          [tokens.surface.current.hover]: surfaceToneContext.success.hover,
          [tokens.surface.current.selected]: surfaceToneContext.success.selected,
          [tokens.surface.current.emphasis]: surfaceToneContext.success.selected,
          [tokens.surface.current.emphasisHover]: surfaceToneContext.success.selected,
          [tokens.surface.current.emphasisSelected]: surfaceToneContext.success.selected,
          [tokens.surface.current.input]: inputColor,
        },
      },
    },

    emphasis: {
      true: {
        vars: {
          [tokens.surface.current.background]: tokens.surface.current.emphasis,
          [tokens.surface.current.hover]: tokens.surface.current.emphasisHover,
          [tokens.surface.current.selected]: tokens.surface.current.emphasisSelected,
          [tokens.surface.current.input]: inputColor,
        },
      },
    },
  },
});
