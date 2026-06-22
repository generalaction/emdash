/**
 * ImageViewerDialog — displays a single image attachment in an xl Dialog.
 *
 * Controlled via `open`/`onOpenChange`. The `src` (data URL) and `alt` (image
 * name) come from `ChatImageAttachment`. When `src` is absent the dialog shows
 * a neutral placeholder message instead of a broken image.
 */

import * as React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../primitives/dialog';

export interface ImageViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Data URL of the image to display; absent when bytes could not be resolved. */
  src?: string;
  /** Human-readable image name shown in the dialog header. */
  alt?: string;
}

export function ImageViewerDialog({ open, onOpenChange, src, alt }: ImageViewerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{alt ?? 'Image'}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 pt-0">
          {src ? (
            <img src={src} alt={alt ?? 'Image'} className="max-h-full max-w-full object-contain" />
          ) : (
            <p className="text-sm text-foreground-muted">Image content unavailable.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
