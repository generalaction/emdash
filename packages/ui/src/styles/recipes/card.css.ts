/**
 * card.css.ts — Vanilla Extract recipe for card containers.
 *
 * Composes the surface recipe for elevation + border + radius + padding.
 * The card pattern appears across ~88 desktop renderer files — highest-leverage
 * abstraction in the design system.
 *
 * Usage:
 *   import { card } from '@emdash/ui/styles/recipes/card';
 *   <div className={card({ padding: 'md', interactive: true })} />
 *
 * Variants:
 *   padding     — none | sm | md | lg (default: md)
 *   radius      — sm | md | lg (default: md)
 *   interactive — true | false: hover/selected state (default: false)
 *   level       — sunken | base | elevated | paper (default: base)
 *   status      — destructive | warning | info (optional)
 */

import { recipe } from '@vanilla-extract/recipes';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { tokenVars } from '../../theme/tokens.css';
import { vars } from '@theme/core/contract/contract.css';

export const card = recipe({
  base: {
    backgroundColor: vars.surface,
    color: vars.foreground,
    border: `1px solid ${vars.surfaceBorder}`,
    overflow: 'hidden',
  },

  variants: {
    level: {
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

    radius: {
      sm: { borderRadius: tokenVars.radiusSm },
      md: { borderRadius: tokenVars.radiusMd },
      lg: { borderRadius: tokenVars.radiusLg },
    },

    padding: {
      none: { padding: 0 },
      sm: { padding: '0.5rem' },
      md: { padding: '0.75rem' },
      lg: { padding: '1rem' },
    },

    interactive: {
      true: {
        cursor: 'pointer',
        transition: 'background-color 150ms',
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
    radius: 'md',
    padding: 'md',
  },
});

export type CardVariants = RecipeVariants<typeof card>;
