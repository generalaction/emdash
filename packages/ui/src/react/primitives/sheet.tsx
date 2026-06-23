import { Drawer } from '@base-ui/react/drawer';
import { XIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';
import { Button } from './button';
import { ScrollFade } from './scroll-fade';
import * as styles from './sheet.css';

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
      className={cn(styles.backdrop, className)}
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
        className={cn('surface-base', styles.sheetContent({ side }), className)}
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
    <div data-slot="sheet-header" className={cn(styles.sheetHeader, className)} {...props}>
      <div className={styles.sheetHeaderInner}>{children}</div>
      {showCloseButton && (
        <Drawer.Close
          render={
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label="Close"
              className={styles.closeButtonOverride}
            />
          }
        >
          <XIcon style={{ width: '1rem', height: '1rem' }} />
        </Drawer.Close>
      )}
    </div>
  );
}

function SheetTitle({ className, ...props }: Drawer.Title.Props) {
  return (
    <Drawer.Title data-slot="sheet-title" className={cn(styles.sheetTitle, className)} {...props} />
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
      style={{ minHeight: 0, flex: '1 1 0%', ...style }}
      viewportClassName={cn(styles.sheetBody, className)}
    >
      {children}
    </ScrollFade>
  );
}

function SheetFooter({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-footer" className={cn(styles.sheetFooter, className)} {...props}>
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
