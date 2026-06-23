/**
 * surface.css.ts — Vanilla Extract recipe for surface-level containers.
 *
 * Applies the surface cascade vars to an element so it reads from the correct
 * level in the elevation hierarchy. Wraps the same scope-class semantics as
 * surfaces.css.ts but makes them composable with VE recipe().
 *
 * Usage:
 *   import { surface } from '@emdash/ui/styles/recipes/surface';
 *   <div className={surface({ level: 'elevated', interactive: true })} />
 *
 * Variants:
 *   level       — sunken | base | elevated | paper (default: base)
 *   status      — destructive | warning | info (default: none)
 *   interactive — true | false: adds hover/selected cursor + transition
 */

import { recipe } from '@vanilla-extract/recipes';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { vars } from '@theme/core/contract/contract.css';

export const surface = recipe({
  base: {
    backgroundColor: vars.surface,
    color: vars.foreground,
  },

  variants: {
    level: {
      // Sunken — recessed, below the base plane (sidebars, trays)
      sunken: {
        vars: {
          [vars.surface]: vars.surfaceSunken,
          [vars.surfaceHover]: vars.surfaceSunkenHover,
          [vars.surfaceSelected]: vars.surfaceSunkenSelected,
          [vars.surfaceEmphasis]: vars.surfaceBase,
          [vars.surfaceEmphasisHover]: vars.surfaceBaseHover,
          [vars.surfaceEmphasisSelected]: vars.surfaceBaseEmphasisSelected,
        },
      },
      // Base — default surface level (content areas, cards on sunken canvas)
      base: {
        vars: {
          [vars.surface]: vars.surfaceBase,
          [vars.surfaceHover]: vars.surfaceBaseHover,
          [vars.surfaceSelected]: vars.surfaceBaseSelected,
          [vars.surfaceEmphasis]: vars.surfaceBaseEmphasis,
          [vars.surfaceEmphasisHover]: vars.surfaceBaseEmphasisHover,
          [vars.surfaceEmphasisSelected]: vars.surfaceBaseEmphasisSelected,
        },
      },
      // Elevated — raised above base (popovers, dialogs, dropdowns)
      elevated: {
        vars: {
          [vars.surface]: vars.surfaceElevated,
          [vars.surfaceHover]: vars.surfaceElevatedHover,
          [vars.surfaceSelected]: vars.surfaceElevatedSelected,
          [vars.surfaceEmphasis]: vars.surfaceElevatedEmphasis,
          [vars.surfaceEmphasisHover]: vars.surfaceElevatedEmphasisHover,
          [vars.surfaceEmphasisSelected]: vars.surfaceElevatedEmphasisSelected,
        },
      },
      // Paper — maximum elevation (tooltip-level, floating panels)
      paper: {
        vars: {
          [vars.surface]: vars.surfacePaper,
          [vars.surfaceHover]: vars.surfacePaperHover,
          [vars.surfaceSelected]: vars.surfacePaperSelected,
          [vars.surfaceEmphasis]: vars.surfaceElevatedEmphasis,
          [vars.surfaceEmphasisHover]: vars.surfaceElevatedEmphasisHover,
          [vars.surfaceEmphasisSelected]: vars.surfaceElevatedEmphasisSelected,
        },
      },
    },

    status: {
      destructive: {
        vars: {
          [vars.surface]: vars.surfaceDestructive,
          [vars.surfaceForeground]: vars.surfaceDestructiveForeground,
          [vars.surfaceBorder]: vars.surfaceDestructiveBorder,
          [vars.surfaceHover]: vars.surfaceDestructiveHover,
          [vars.surfaceSelected]: vars.surfaceDestructiveSelected,
        },
      },
      warning: {
        vars: {
          [vars.surface]: vars.surfaceWarning,
          [vars.surfaceForeground]: vars.surfaceWarningForeground,
          [vars.surfaceBorder]: vars.surfaceWarningBorder,
          [vars.surfaceHover]: vars.surfaceWarningHover,
          [vars.surfaceSelected]: vars.surfaceWarningSelected,
        },
      },
      info: {
        vars: {
          [vars.surface]: vars.surfaceInfo,
          [vars.surfaceForeground]: vars.surfaceInfoForeground,
          [vars.surfaceBorder]: vars.surfaceInfoBorder,
          [vars.surfaceHover]: vars.surfaceInfoHover,
          [vars.surfaceSelected]: vars.surfaceInfoSelected,
        },
      },
    },

    interactive: {
      true: {
        cursor: 'pointer',
        transition: 'background-color 150ms, color 150ms',
        selectors: {
          '&:hover': { backgroundColor: vars.surfaceHover },
          '&[data-selected]': { backgroundColor: vars.surfaceSelected },
          '&[aria-selected="true"]': { backgroundColor: vars.surfaceSelected },
        },
      },
    },
  },

  defaultVariants: {
    level: 'base',
  },
});

export type SurfaceVariants = RecipeVariants<typeof surface>;
