import { Drawer } from '@base-ui/react/drawer';
import { XIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { ScrollFade } from './scroll-fade';

// ── Side option ───────────────────────────────────────────────────────────────

export type SheetSide = 'right' | 'left';

// ── Root parts ────────────────────────────────────────────────────────────────

function Sheet({ ...props }: Drawer.Root.Props) {
  return <Drawer.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: Drawer.Trigger.Props) {
  return <Drawer.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetPortal({ ...props }: Drawer.Portal.Props) {
  return <Drawer.Portal data-slot="sheet-portal" {...props} />;
}

function SheetClose({ ...props }: Drawer.Close.Props) {
  return <Drawer.Close data-slot="sheet-close" {...props} />;
}

function SheetBackdrop({ className, ...props }: Drawer.Backdrop.Props) {
  return (
    <Drawer.Backdrop
      data-slot="sheet-backdrop"
      className={cn(
        'fixed inset-0 z-50 bg-black/40 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className
      )}
      {...props}
    />
  );
}

// ── Content shell ─────────────────────────────────────────────────────────────

function SheetContent({
  className,
  children,
  side = 'right',
  ...props
}: Drawer.Popup.Props & { side?: SheetSide }) {
  return (
    <SheetPortal>
      <SheetBackdrop />
      <Drawer.Popup
        data-slot="sheet-content"
        className={cn(
          // Base — fixed panel, full height, flex-col; 75vw on small screens
          'surface-base fixed inset-y-0 z-50 flex h-full w-3/4 flex-col overflow-hidden bg-surface text-sm text-foreground shadow-lg ring-1 ring-foreground/10 outline-none',
          // Animation duration
          'duration-200',
          // Side-specific position, rounding, max-width cap, and slide animation.
          // Widths match the emdash-desktop sheet: right → xl (36rem), left → md (28rem).
          side === 'right'
            ? 'right-0 sm:max-w-xl data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right'
            : 'left-0 sm:max-w-md data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left',
          className
        )}
        {...props}
      >
        {children}
      </Drawer.Popup>
    </SheetPortal>
  );
}

// ── Header / Body / Footer ────────────────────────────────────────────────────

function SheetHeader({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<'div'> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex shrink-0 items-start justify-between gap-2 p-4', className)}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
      {showCloseButton && (
        <Drawer.Close
          render={
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label="Close"
              className="-mt-1 -mr-1 shrink-0 text-foreground-muted hover:text-foreground"
            />
          }
        >
          <XIcon className="size-4" />
        </Drawer.Close>
      )}
    </div>
  );
}

function SheetTitle({ className, ...props }: Drawer.Title.Props) {
  return (
    <Drawer.Title
      data-slot="sheet-title"
      className={cn('text-sm tracking-tight text-foreground', className)}
      {...props}
    />
  );
}

function SheetBody({
  className,
  children,
  style,
}: {
  className?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <ScrollFade
      axis="y"
      edges={['top']}
      className="min-h-0 flex-1"
      viewportClassName={cn(
        'flex w-full flex-col gap-2 p-4 pt-0 focus-visible:outline-none',
        className
      )}
      style={style}
    >
      {children}
    </ScrollFade>
  );
}

function SheetFooter({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-surface-base-emphasis p-3 sm:flex-row sm:justify-end',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

// ── Exports ───────────────────────────────────────────────────────────────────

export {
  Sheet,
  SheetTrigger,
  SheetPortal,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetBody,
  SheetFooter,
};
