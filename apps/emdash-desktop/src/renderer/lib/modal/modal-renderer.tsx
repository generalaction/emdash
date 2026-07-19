import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { modalScope } from '@core/features/workbench/contributions/scopes';
import { modalCatalog } from '@core/manifests/browser/modal-catalog';
import {
  ModalHostContext,
  type ModalHostController,
  type ModalPosition,
  type ModalSize,
} from '@core/primitives/modals/react';
import { disabled, enabled, hidden, type ViewScopeImpl } from '@core/primitives/view-scopes/api';
import { useViewScope, ViewScopeInstanceProvider } from '@core/primitives/view-scopes/react';
import { confirmRegistry } from '@renderer/lib/keybindings';
import { Dialog, DialogOverlay, DialogPortal } from '@renderer/lib/ui/dialog';
import { cn } from '@renderer/utils/utils';
import { modalStore } from './modal-store';

type RuntimeModalEntry = {
  // The catalog erases each component's props at this renderer boundary.
  // oxlint-disable-next-line typescript/no-explicit-any
  readonly component: React.ComponentType<any>;
  readonly size?: ModalSize;
  readonly position?: ModalPosition;
  readonly ignoreOutsidePressAfterWindowBlur?: boolean;
};

const SIZE_CLASSES: Record<ModalSize, string> = {
  xs: 'sm:max-w-xs',
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
};

const POSITION_CLASSES: Record<ModalPosition, string> = {
  center: 'top-1/2 -translate-y-1/2',
  top: 'top-[15%] translate-y-0',
};

export const ModalRenderer = observer(function ModalRenderer() {
  const entry = modalStore.activeModalId
    ? (modalCatalog.byId(modalStore.activeModalId) as RuntimeModalEntry | undefined)
    : undefined;
  const Component = entry?.component;

  // Preserve the last rendered content and entry config so the close animation plays with the
  // correct dimensions and full content rather than collapsing while the popup fades out.
  // oxlint-disable-next-line typescript/no-explicit-any
  const lastComponentRef = useRef<React.ComponentType<any> | null>(null);
  const lastArgsRef = useRef<Record<string, unknown> | null>(null);
  const lastEntryRef = useRef<RuntimeModalEntry | null>(null);
  const lastModalIdRef = useRef<string | null>(null);

  if (modalStore.isOpen && modalStore.activeModalId && Component && modalStore.activeModalArgs) {
    lastComponentRef.current = Component;
    lastArgsRef.current = modalStore.activeModalArgs;
    lastEntryRef.current = entry ?? null;
    lastModalIdRef.current = modalStore.activeModalId;
  }

  const DisplayComponent = lastComponentRef.current;
  const displayArgs = lastArgsRef.current;
  const displayEntry = lastEntryRef.current;
  const displayModalId = lastModalIdRef.current;
  const activeModalId = modalStore.activeModalId;
  const activeEntryRef = useRef<RuntimeModalEntry | null>(null);
  const ignoreNextOutsidePressRef = useRef(false);
  const implementation = {
    'modal.close': () => ({
      availability: () =>
        modalStore.closeGuardActive ? disabled('This dialog cannot be closed yet') : enabled,
      execute: () => modalStore.dismiss('passive'),
    }),
    'app.confirm': () => ({
      availability: () => (confirmRegistry.current?.isEnabled() ? enabled : hidden),
      execute: () => confirmRegistry.current?.trigger(),
    }),
  } satisfies ViewScopeImpl<typeof modalScope>;
  const { attachRef, instance } = useViewScope(modalScope(), implementation);

  activeEntryRef.current = entry ?? null;

  const completeModal = useCallback((result: unknown) => modalStore.complete(result), []);
  const dismissModal = useCallback(() => modalStore.dismiss(), []);
  const setCloseGuard = useCallback((active: boolean) => modalStore.setCloseGuard(active), []);
  const hasActiveCloseGuard = modalStore.closeGuardActive;
  const hostController = useMemo<ModalHostController>(
    () => ({
      complete: completeModal,
      dismiss: dismissModal,
      setCloseGuard,
      hasActiveCloseGuard,
    }),
    [completeModal, dismissModal, hasActiveCloseGuard, setCloseGuard]
  );

  useEffect(() => {
    ignoreNextOutsidePressRef.current = false;
  }, [activeModalId]);

  useEffect(() => {
    const handleWindowBlur = () => {
      if (modalStore.isOpen && activeEntryRef.current?.ignoreOutsidePressAfterWindowBlur) {
        ignoreNextOutsidePressRef.current = true;
      }
    };

    window.addEventListener('blur', handleWindowBlur);
    return () => window.removeEventListener('blur', handleWindowBlur);
  }, []);

  const handleOpenChange = (
    open: boolean,
    eventDetails: DialogPrimitive.Root.ChangeEventDetails
  ) => {
    if (!open && modalStore.isOpen) {
      if (eventDetails.reason === 'escape-key') return;
      const isOutsidePress = eventDetails.reason === 'outside-press';
      if (
        isOutsidePress &&
        displayEntry?.ignoreOutsidePressAfterWindowBlur &&
        ignoreNextOutsidePressRef.current
      ) {
        ignoreNextOutsidePressRef.current = false;
        return;
      }

      if (modalStore.closeGuardActive && isOutsidePress) return;
      ignoreNextOutsidePressRef.current = false;
      modalStore.dismiss('passive');
    }
  };

  const popupRef = useRef<HTMLDivElement>(null);
  const attachPopupRef = useCallback(
    (element: HTMLDivElement | null) => {
      popupRef.current = element;
      attachRef(element);
    },
    [attachRef]
  );

  // Restore focus to the element captured when the first modal in a flow opens.
  useEffect(
    () =>
      reaction(
        () => modalStore.isOpen,
        (isOpen) => {
          if (!isOpen) {
            const el = modalStore.consumePreviousFocus();
            if (!el) return;
            requestAnimationFrame(() => {
              if (el.isConnected) el.focus();
            });
          }
        }
      ),
    []
  );

  const initialFocus = useCallback(() => {
    const target = popupRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    if (!target) return true;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      requestAnimationFrame(() => target.select());
    }
    return target;
  }, []);

  return (
    <Dialog open={modalStore.isOpen} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          ref={attachPopupRef}
          finalFocus={false}
          initialFocus={initialFocus}
          data-slot="dialog-content"
          onPointerDownCapture={() => {
            if (displayEntry?.ignoreOutsidePressAfterWindowBlur) {
              ignoreNextOutsidePressRef.current = false;
            }
          }}
          className={cn(
            'fixed left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-xl bg-background-quaternary text-sm ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            POSITION_CLASSES[displayEntry?.position ?? 'center'],
            SIZE_CLASSES[displayEntry?.size ?? 'md']
          )}
        >
          {DisplayComponent && displayArgs && displayModalId ? (
            <ViewScopeInstanceProvider instance={instance}>
              <ModalHostContext.Provider value={{ id: displayModalId, controller: hostController }}>
                <DisplayComponent {...displayArgs} />
              </ModalHostContext.Provider>
            </ViewScopeInstanceProvider>
          ) : null}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
});
