import { cva, type VariantProps } from 'class-variance-authority';

/**
 * Shared visual tokens for all text-entry surfaces: Input, Textarea, InputGroup.
 * bg-transparent lets inputs inherit whatever surface they sit on.
 */
export const inputVariants = cva(
  [
    'w-full min-w-0 rounded-md border border-border bg-transparent',
    'text-sm text-foreground placeholder:text-foreground-passive',
    'transition-[color,box-shadow] outline-none',
    'hover:border-border-1',
    'focus-visible:border-border-primary focus-visible:ring-3 focus-visible:ring-border-primary/30',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    'aria-invalid:border-border-destructive aria-invalid:ring-3 aria-invalid:ring-border-destructive/20',
    '[color-scheme:light]',
  ].join(' '),
  {
    variants: {
      size: {
        base: 'h-8 px-2.5 py-1',
        sm: 'h-6 px-2 py-0.5 text-xs',
      },
    },
    defaultVariants: {
      size: 'base',
    },
  },
);

export type InputVariantProps = VariantProps<typeof inputVariants>;
