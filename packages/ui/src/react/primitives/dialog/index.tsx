import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Button } from '@react/primitives/button';
import { ScrollContainer } from '@react/primitives/scroll-container';
import { cx } from '@styles/utilities/cx';
import { XIcon } from 'lucide-react';
import * as React from 'react';
import * as styles from './dialog.css';

export type DialogSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

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
      className={cx(styles.overlay, className)}
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
      <div className={styles.positioner}>
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cx('surface-base', styles.content({ size }), className)}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </div>
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
    <div data-slot="dialog-header" className={cx(styles.header, className)} {...props}>
      <div className={styles.headerInner}>{children}</div>
      {showCloseButton && (
        <DialogPrimitive.Close
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
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogBody({
  className,
  children,
  style,
  maxHeight,
  topFade = true,
}: {
  className?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  maxHeight?: number | string;
  topFade?: boolean;
}) {
  return (
    <ScrollContainer
      maxHeight={maxHeight}
      topFade={topFade}
      style={{ minHeight: 0, ...style }}
      viewportClassName={cx(styles.body, className)}
    >
      {children}
    </ScrollContainer>
  );
}

function DialogFooter({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-footer" className={cx(styles.footer, className)} {...props}>
      {children}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cx(styles.title, className)}
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
