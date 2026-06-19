/**
 * ConfirmationDialog
 *
 * A controlled convenience dialog for confirm/cancel decisions, composed from
 * the Dialog primitive. Renders a title, an optional description/body, and a
 * Cancel + Confirm footer.
 *
 * Closing behavior:
 *  - Cancel always closes (after invoking `onCancel`).
 *  - Confirm awaits `onConfirm`; it closes on success and stays open if the
 *    handler throws/rejects, so the caller can surface an error. Pair with
 *    `isConfirming` to disable the actions while an async handler runs.
 */

import * as React from 'react';
import { Button } from '../primitives/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogSize,
} from '../primitives/dialog';

export interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  /** Optional body text. Strings are wrapped in a muted paragraph. */
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Tone of the confirm button. Defaults to 'neutral'. */
  tone?: 'neutral' | 'destructive';
  /** Disables both actions while an async confirm handler is in flight. */
  isConfirming?: boolean;
  /** Dialog size. Defaults to 'xs'. */
  size?: DialogSize;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  /** Optional extra content rendered in the body below the description. */
  children?: React.ReactNode;
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'neutral',
  isConfirming = false,
  size = 'xs',
  onConfirm,
  onCancel,
  children,
}: ConfirmationDialogProps) {
  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const handleConfirm = async () => {
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // Leave the dialog open so the caller can surface the failure.
    }
  };

  const hasBody = description != null || children != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={size}>
        <DialogHeader showCloseButton={false}>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {hasBody && (
          <DialogBody>
            {typeof description === 'string' ? (
              <p className="text-foreground-muted">{description}</p>
            ) : (
              description
            )}
            {children}
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={handleCancel} disabled={isConfirming}>
            {cancelLabel}
          </Button>
          <Button variant="primary" tone={tone} onClick={handleConfirm} disabled={isConfirming}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
