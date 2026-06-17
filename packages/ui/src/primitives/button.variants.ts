import { cva, type VariantProps } from 'class-variance-authority';

/**
 * buttonVariants — framework-neutral CVA recipe for the shared button surface.
 *
 * Variants (default/Primary, outline, ghost, link) and sizes (sm, default, lg
 * plus icon-sm, icon, icon-lg) are kept to the cross-framework minimal set.
 * Import this from `@emdash/ui/recipes/button` in Solid/chat-ui components to
 * avoid pulling in the React bundle.
 *
 * The React <Button> component (in button.tsx) is the full-featured variant and
 * includes additional variants (secondary, destructive) and sizes (xs, icon-xs,
 * icon-md) for the desktop app.
 */
export const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-normal whitespace-nowrap transition-all outline-none select-none focus-visible:border-border-primary focus-visible:ring-3 focus-visible:ring-border-primary/30 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary-button-background text-primary-button-foreground hover:bg-primary-button-background-hover border border-primary-button-border',
        outline:
          'border-border bg-surface hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-hover aria-expanded:text-foreground',
        ghost:
          'hover:bg-surface-hover hover:text-foreground text-foreground-muted aria-expanded:bg-surface-hover aria-expanded:text-foreground',
        link: 'text-foreground',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        sm: 'h-7 gap-1 rounded-[min(var(--radius-md),10px)] px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5',
        lg: 'h-10 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        icon: 'size-8',
        'icon-sm': 'size-7 rounded-[min(var(--radius-md),10px)]',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
