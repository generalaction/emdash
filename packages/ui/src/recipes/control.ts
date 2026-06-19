/**
 * controlVariants — the single CVA recipe for every interactive control.
 *
 * Every clickable primitive (Button, Toggle, Tabs tab, TriggerButton) is
 * styled from this one recipe, so sizes/variants/tokens live in one place.
 *
 * Axes:
 *   variant  ghost | primary          — visual weight
 *   tone     neutral | destructive    — semantic intent
 *   size     base (32px) | sm (24px) | link (inline, no box)
 *   icon     boolean — square aspect ratio, no horizontal padding
 *
 * "Active" state is attribute-driven so controls with different ARIA roles
 * all share the same visual treatment with zero extra color declarations:
 *   ghost active  → bg-surface-selected  (adapts to current surface scope)
 *   primary active → bg-primary-button-background-hover
 *
 * Active attributes recognised (base-ui and manual):
 *   aria-pressed, aria-selected, aria-expanded,
 *   data-pressed, data-selected, data-popup-open, data-[active=true]
 *
 * Framework-neutral: import from @emdash/ui/recipes/control in Solid/plain-JS.
 */

import { cva, type VariantProps } from 'class-variance-authority';

export const controlVariants = cva(
  [
    'group/control inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent',
    'bg-clip-padding text-sm font-normal whitespace-nowrap',
    'transition-all outline-none select-none',
    'focus-visible:border-border-primary focus-visible:ring-3 focus-visible:ring-border-primary/30',
    'disabled:pointer-events-none disabled:opacity-50',
    'data-disabled:pointer-events-none data-disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(' '),
  {
    variants: {
      variant: {
        ghost: [
          'text-foreground-muted',
          'hover:bg-surface-hover hover:text-foreground',
          // active — all attribute forms base-ui may set
          'aria-expanded:bg-surface-selected aria-expanded:text-foreground',
          'aria-pressed:bg-surface-selected aria-pressed:text-foreground',
          'aria-selected:bg-surface-selected aria-selected:text-foreground',
          'data-pressed:bg-surface-selected data-pressed:text-foreground',
          'data-selected:bg-surface-selected data-selected:text-foreground',
          'data-popup-open:bg-surface-selected data-popup-open:text-foreground',
          'data-[active=true]:bg-surface-selected data-[active=true]:text-foreground',
        ].join(' '),
        primary: [
          'bg-primary-button-background text-primary-button-foreground',
          'border border-primary-button-border',
          'hover:bg-primary-button-background-hover',
          'aria-expanded:bg-primary-button-background-hover',
          'data-popup-open:bg-primary-button-background-hover',
          'data-[active=true]:bg-primary-button-background-hover',
        ].join(' '),
      },
      tone: {
        neutral: '',
        destructive: '',
      },
      size: {
        base: 'h-8 gap-1.5 px-2.5',
        sm: [
          'h-6 gap-1 px-2 text-xs rounded-md',
          "[&_svg:not([class*='size-'])]:size-3",
        ].join(' '),
        link: [
          'h-auto gap-1 border-0 bg-transparent! p-0',
          'text-foreground',
          'hover:bg-transparent! hover:underline underline-offset-2',
          // reset active states inherited from ghost for link variant
          'aria-pressed:bg-transparent! aria-selected:bg-transparent! data-pressed:bg-transparent!',
        ].join(' '),
      },
      icon: {
        true: '',
        false: '',
      },
    },
    compoundVariants: [
      // ghost destructive — uses surface-relative status tokens so it reads correctly
      // on every elevation and adapts inside a .surface-destructive room.
      {
        variant: 'ghost',
        tone: 'destructive',
        class: [
          'text-foreground-destructive',
          'hover:bg-surface-destructive-hover hover:text-foreground-destructive',
          'data-[active=true]:bg-surface-destructive-selected',
          'aria-pressed:bg-surface-destructive-selected aria-selected:bg-surface-destructive-selected',
          'data-pressed:bg-surface-destructive-selected data-popup-open:bg-surface-destructive-selected',
        ].join(' '),
      },
      // primary destructive
      {
        variant: 'primary',
        tone: 'destructive',
        class: [
          'bg-background-destructive border-border-destructive text-foreground-destructive',
          'hover:bg-background-destructive/80',
          'focus-visible:border-border-destructive/40 focus-visible:ring-border-destructive/20',
        ].join(' '),
      },
      // icon base — square, no horizontal padding
      { icon: true, size: 'base', class: 'size-8 px-0' },
      // icon sm — square, no horizontal padding
      { icon: true, size: 'sm', class: 'size-6 px-0' },
    ],
    defaultVariants: {
      variant: 'ghost',
      tone: 'neutral',
      size: 'base',
      icon: false,
    },
  },
);

export type ControlVariantProps = VariantProps<typeof controlVariants>;
