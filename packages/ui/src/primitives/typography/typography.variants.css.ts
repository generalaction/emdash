/**
 * textVariants — Vanilla Extract recipe replacing the CVA textVariants.
 * Each variant applies the role's type tokens directly via the --type-* CSS vars
 * from theme.base.css, replacing the text-role-* class indirection.
 */

import { recipe } from '@vanilla-extract/recipes';
import type { RecipeVariants } from '@vanilla-extract/recipes';
import { vars } from '../../theme/contract/contract.css';

export const textVariants = recipe({
  base: {},

  variants: {
    variant: {
      body: {
        fontFamily: 'var(--type-body-font-family)',
        fontSize: 'var(--type-body-font-size)',
        fontWeight: 'var(--type-body-font-weight)' as any,
        lineHeight: 'var(--type-body-line-height)',
      },
      bodyBold: {
        fontFamily: 'var(--type-body-bold-font-family)',
        fontSize: 'var(--type-body-bold-font-size)',
        fontWeight: 'var(--type-body-bold-font-weight)' as any,
        lineHeight: 'var(--type-body-bold-line-height)',
      },
      bodyItalic: {
        fontFamily: 'var(--type-body-italic-font-family)',
        fontSize: 'var(--type-body-italic-font-size)',
        fontWeight: 'var(--type-body-italic-font-weight)' as any,
        fontStyle: 'italic',
        lineHeight: 'var(--type-body-italic-line-height)',
      },
      bodyLink: {
        fontFamily: 'var(--type-body-link-font-family)',
        fontSize: 'var(--type-body-link-font-size)',
        fontWeight: 'var(--type-body-link-font-weight)' as any,
        lineHeight: 'var(--type-body-link-line-height)',
      },
      h1: {
        fontFamily: 'var(--type-h1-font-family)',
        fontSize: 'var(--type-h1-font-size)',
        fontWeight: 'var(--type-h1-font-weight)' as any,
        lineHeight: 'var(--type-h1-line-height)',
      },
      h2: {
        fontFamily: 'var(--type-h2-font-family)',
        fontSize: 'var(--type-h2-font-size)',
        fontWeight: 'var(--type-h2-font-weight)' as any,
        lineHeight: 'var(--type-h2-line-height)',
      },
      h3: {
        fontFamily: 'var(--type-h3-font-family)',
        fontSize: 'var(--type-h3-font-size)',
        fontWeight: 'var(--type-h3-font-weight)' as any,
        lineHeight: 'var(--type-h3-line-height)',
      },
      inlineCode: {
        fontFamily: 'var(--type-inline-code-font-family)',
        fontSize: 'var(--type-inline-code-font-size)',
        fontWeight: 'var(--type-inline-code-font-weight)' as any,
        lineHeight: 'var(--type-inline-code-line-height)',
      },
      code: {
        fontFamily: 'var(--type-code-font-family)',
        fontSize: 'var(--type-code-font-size)',
        fontWeight: 'var(--type-code-font-weight)' as any,
        lineHeight: 'var(--type-code-line-height)',
      },
      codeLang: {
        fontFamily: 'var(--type-code-lang-font-family)',
        fontSize: 'var(--type-code-lang-font-size)',
        fontWeight: 'var(--type-code-lang-font-weight)' as any,
        lineHeight: 'var(--type-code-lang-line-height)',
      },
      mention: {
        fontFamily: 'var(--type-mention-font-family)',
        fontSize: 'var(--type-mention-font-size)',
        fontWeight: 'var(--type-mention-font-weight)' as any,
        lineHeight: 'var(--type-mention-line-height)',
      },
    },
    tone: {
      default: { color: vars.foreground },
      muted: { color: vars.foregroundMuted },
      passive: { color: vars.foregroundPassive },
      inherit: {},
    },
  },

  defaultVariants: {
    variant: 'body',
    tone: 'inherit',
  },
});

export type TextVariantProps = NonNullable<RecipeVariants<typeof textVariants>>;
