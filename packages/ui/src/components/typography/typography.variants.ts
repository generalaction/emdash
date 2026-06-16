import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

export { cn };

/**
 * textVariants — CVA recipe mapping semantic prose roles to typography.css classes.
 *
 * variant: the typographic role (body, bodyBold, h1, h2, h3, …).
 * tone: optional Tailwind color utility applied on top of the role.
 *
 * Works in React (className=) and in any framework that generates the same Tailwind
 * classes (chat-ui Solid: class=), provided the typography.css file and the Tailwind
 * @theme mapping are both loaded.
 */
export const textVariants = cva('', {
  variants: {
    variant: {
      body: 'text-role-body',
      bodyBold: 'text-role-body-bold',
      bodyItalic: 'text-role-body-italic',
      bodyLink: 'text-role-body-link',
      h1: 'text-role-h1',
      h2: 'text-role-h2',
      h3: 'text-role-h3',
      inlineCode: 'text-role-inline-code',
      code: 'text-role-code',
      codeLang: 'text-role-code-lang',
      mention: 'text-role-mention',
    },
    tone: {
      default: 'text-foreground',
      muted: 'text-foreground-muted',
      passive: 'text-foreground-passive',
      inherit: '',
    },
  },
  defaultVariants: {
    variant: 'body',
    tone: 'inherit',
  },
});

export type TextVariantProps = VariantProps<typeof textVariants>;
