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

  const lastFocusedOutsideToast = useRef<HTMLElement | null>(null);
  const previousToastsCount = useRef(0);

  const isInToastViewport = (element: Element | null) =>
    element?.closest?.('[data-radix-toast-viewport]') != null;

  // Track the most recent focus target outside the toast viewport so we can
  // restore it if Radix shifts focus to the toast/viewport when a toast opens.
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !isInToastViewport(active) && active !== document.body) {
      lastFocusedOutsideToast.current = active;
    }

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (isInToastViewport(target)) return;
      if (target === document.body) return;
      lastFocusedOutsideToast.current = target;
    };

    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  useEffect(() => {
    const currentToastsCount = toasts.length;
    const toastsChanged = currentToastsCount !== previousToastsCount.current;
    if (!toastsChanged) return;

    requestAnimationFrame(() => {
      const currentFocus = document.activeElement;
      const focusIsOnToast = isInToastViewport(currentFocus);
      const focusIsOnBody = currentFocus === document.body;
      const restoreTarget = lastFocusedOutsideToast.current;

      if (
        (focusIsOnToast || focusIsOnBody) &&
        restoreTarget &&
        document.body.contains(restoreTarget) &&
        restoreTarget !== document.activeElement
      ) {
        restoreTarget.focus();
      }
    });

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
