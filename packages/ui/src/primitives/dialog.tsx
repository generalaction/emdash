import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { ScrollFade } from './scroll-fade';

// ── Size options (match emdash-desktop modal sizes) ───────────────────────────

export type DialogSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASSES: Record<DialogSize, string> = {
  xs: 'sm:max-w-xs',
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  // XL: spacious viewport-relative dialog — up to 80% width and 80vh tall.
  xl: 'sm:max-w-[80vw] sm:h-[80vh]',
};

// ── Root parts ────────────────────────────────────────────────────────────────

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/40 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className
      )}
      {...props}
    />
  );
}

// ── Content shell ─────────────────────────────────────────────────────────────

function DialogContent({
  className,
  children,
  size = 'md',
  ...props
}: DialogPrimitive.Popup.Props & { size?: DialogSize }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'surface-base fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-surface text-sm text-foreground shadow-md ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          SIZE_CLASSES[size],
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

// ── Header / Body / Footer ────────────────────────────────────────────────────

function DialogHeader({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<'div'> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex shrink-0 items-start justify-between gap-2 p-4', className)}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
      {showCloseButton && (
        <DialogPrimitive.Close
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
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogBody({
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
      className="min-h-0"
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

function DialogFooter({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex shrink-0 bg-surface-base-emphasis flex-col-reverse gap-2 border-t border-border p-3 sm:flex-row sm:justify-end',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-sm  tracking-tight text-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
