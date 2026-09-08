/**
 * textVariants — Vanilla Extract recipe replacing the CVA textVariants.
 * Each variant applies canonical Theme Token Values while retaining the
 * established role-specific line heights.
 */

import { tokens } from '@emdash/theme';
import { recipe } from '@styles/index';

export const textVariants = recipe({
  base: {},

  variants: {
    variant: {
      body: {
        fontFamily: tokens.typography.family.sans,
        fontSize: tokens.typography.size.base,
        fontWeight: tokens.typography.weight.normal,
        lineHeight: '20px',
      },
      bodyItalic: {
        fontFamily: tokens.typography.family.sans,
        fontSize: tokens.typography.size.base,
        fontWeight: tokens.typography.weight.normal,
        fontStyle: 'italic',
        lineHeight: '20px',
      },
      bodyLink: {
        fontFamily: tokens.typography.family.sans,
        fontSize: tokens.typography.size.base,
        fontWeight: tokens.typography.weight.normal,
        lineHeight: '20px',
      },
      h1: {
        fontFamily: tokens.typography.family.sans,
        fontSize: tokens.typography.size.xl,
        fontWeight: tokens.typography.weight.medium,
        lineHeight: '28px',
      },
      h2: {
        fontFamily: tokens.typography.family.sans,
        fontSize: tokens.typography.size.lg,
        fontWeight: tokens.typography.weight.medium,
        lineHeight: '25px',
      },
      h3: {
        fontFamily: tokens.typography.family.sans,
        fontSize: tokens.typography.size.base,
        fontWeight: tokens.typography.weight.medium,
        lineHeight: '22px',
      },
      section: {
        fontFamily: tokens.typography.family.sans,
        fontSize: tokens.typography.size.sm,
        fontWeight: tokens.typography.weight.normal,
        lineHeight: '18px',
      },
      caption: {
        fontFamily: tokens.typography.family.sans,
        fontSize: tokens.typography.size.xs,
        fontWeight: tokens.typography.weight.medium,
        lineHeight: '16px',
      },
      description: {
        fontFamily: tokens.typography.family.sans,
        fontSize: tokens.typography.size.sm,
        fontWeight: tokens.typography.weight.normal,
        lineHeight: '18px',
      },
      inlineCode: {
        fontFamily: tokens.typography.family.mono,
        fontSize: tokens.typography.size.xs,
        fontWeight: tokens.typography.weight.normal,
        lineHeight: '20px',
      },
      code: {
        fontFamily: tokens.typography.family.mono,
        fontSize: tokens.typography.size.sm,
        fontWeight: tokens.typography.weight.normal,
        lineHeight: '20px',
      },
      codeLang: {
        fontFamily: tokens.typography.family.sans,
        fontSize: tokens.typography.size.tiny,
        fontWeight: tokens.typography.weight.medium,
        lineHeight: '16px',
      },
      mention: {
        fontFamily: tokens.typography.family.sans,
        fontSize: tokens.typography.size.base,
        fontWeight: tokens.typography.weight.semibold,
        lineHeight: '20px',
      },
    },
    tone: {
      default: { color: tokens.foreground.default },
      muted: { color: tokens.foreground.muted },
      passive: { color: tokens.foreground.passive },
      inherit: {},
    },
  },

  defaultVariants: {
    variant: 'body',
    tone: 'inherit',
  },
});
