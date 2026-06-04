import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// Mirrors the desktop button (src/renderer/lib/ui/button.tsx), trimmed to the
// variants the share pages use. `buttonVariants` is exported for anchor tags.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-md border border-transparent text-sm font-normal whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'border-primary-button-border bg-primary-button-background text-primary-button-foreground hover:bg-primary-button-background-hover',
        ghost: 'text-foreground-muted hover:bg-background-1 hover:text-foreground',
      },
      size: {
        default: 'h-8 gap-1.5 px-2.5',
        sm: 'h-7 gap-1 px-2.5 text-[13px]',
        xs: 'h-6.5 gap-1 px-2.5 text-xs',
        pill: 'h-12 gap-2 rounded-full px-7 text-[15px] font-medium',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
