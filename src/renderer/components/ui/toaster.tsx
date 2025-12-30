'use client';

import { useEffect, useRef } from 'react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './toast';
import { useToast } from '../../hooks/use-toast';
import { AlertCircle } from 'lucide-react';

export function Toaster() {
  const { toasts } = useToast();
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const previousToastsCount = useRef(0);

  // Preserve and restore focus when toasts appear/disappear
  useEffect(() => {
    const currentToastsCount = toasts.length;
    const toastsChanged = currentToastsCount !== previousToastsCount.current;

    if (toastsChanged) {
      // Save the currently focused element when a toast appears
      if (currentToastsCount > previousToastsCount.current) {
        previousActiveElement.current = document.activeElement as HTMLElement;
      }

      // Only restore focus if it was stolen by the toast (i.e., current focus is on toast or body)
      // Don't restore if user intentionally moved focus elsewhere
      requestAnimationFrame(() => {
        const currentFocus = document.activeElement;
        const focusIsOnToast = currentFocus?.closest('[data-radix-toast-viewport]') !== null;
        const focusIsOnBody = currentFocus === document.body;

        // Only restore if focus is on toast/body AND we have a valid saved element
        if (
          (focusIsOnToast || focusIsOnBody) &&
          previousActiveElement.current &&
          document.body.contains(previousActiveElement.current)
        ) {
          previousActiveElement.current.focus();
        }
      });
    }

    previousToastsCount.current = currentToastsCount;
  }, [toasts.length]);

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        return (
          <Toast key={id} variant={variant} {...props}>
            <div className="flex gap-3 pr-6">
              {variant === 'destructive' && (
                <AlertCircle className="mt-0.5 h-5 w-5 flex-none self-start text-amber-600 dark:text-amber-400" />
              )}
              <div className="min-w-0 flex-1">
                <div className="grid gap-1">
                  {title && <ToastTitle>{title}</ToastTitle>}
                  {description && <ToastDescription>{description}</ToastDescription>}
                </div>
                {action && <div className="mt-3 flex justify-start">{action}</div>}
              </div>
            </div>
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
