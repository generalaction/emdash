import { observer } from 'mobx-react-lite';
import { createContext, ReactNode, useCallback, useContext } from 'react';
import { modalRegistry } from '@renderer/app/modal-registry';
import { modalStore } from './modal-store';

export interface BaseModalProps<TResult = unknown> {
  onSuccess: (result: TResult) => void;
  onClose: () => void;
}

type UserArgs<MId extends ModalId> = Omit<ModalArgs<MId>, 'onSuccess' | 'onClose'> & {
  onSuccess?: (
    result: ModalArgs<MId> extends { onSuccess: (result: infer R) => void } ? R : unknown
  ) => void;
  onClose?: () => void;
};

export type ModalComponent<TProps = unknown, TResult = unknown> = (
  props: TProps & BaseModalProps<TResult>
) => ReactNode | Promise<ReactNode>;

type ModalId = keyof typeof modalRegistry;

type ModalArgs<TId extends ModalId> = Parameters<(typeof modalRegistry)[TId]['component']>[0];

type ModalContext = {
  closeModal: () => void;
  showModal: <TId extends ModalId>(modal: TId, args: UserArgs<TId>) => void;
  transitionModal: <TId extends ModalId>(modal: TId, args: UserArgs<TId>) => void;
  hasActiveCloseGuard: boolean;
  setCloseGuard: (active: boolean) => void;
};

const ModalContext = createContext<ModalContext | undefined>(undefined);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapArgs<TId extends ModalId>(args: UserArgs<TId>): Record<string, any> {
  return {
    ...args,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (result: any) => {
      modalStore.closeModal('completed');
      args.onSuccess?.(result);
    },
    onClose: () => {
      modalStore.closeModal('dismissed');
      args.onClose?.();
    },
  };
}

export const ModalProvider = observer(function ModalProvider({
  children,
}: {
  children: ReactNode;
}) {
  const showModal = useCallback(<TId extends ModalId>(id: TId, args: UserArgs<TId>) => {
    modalStore.setModal(id, wrapArgs(args));
    window.dispatchEvent(new CustomEvent('emdash:overlay:changed', { detail: { open: true } }));
  }, []);

  const transitionModal = useCallback(<TId extends ModalId>(id: TId, args: UserArgs<TId>) => {
    modalStore.setModal(id, wrapArgs(args));
    // No overlay event — the dialog stays open; AnimatedHeight handles the content swap.
  }, []);

  const closeModal = useCallback(() => {
    modalStore.closeModal('dismissed');
  }, []);

  const setCloseGuard = useCallback((active: boolean) => {
    modalStore.closeGuardActive = active;
  }, []);

  return (
    <ModalContext.Provider
      value={{
        closeModal,
        showModal,
        transitionModal,
        hasActiveCloseGuard: modalStore.closeGuardActive,
        setCloseGuard,
      }}
    >
      {children}
    </ModalContext.Provider>
  );
});

export function useModalContext() {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useWorkspaceOverlayContext must be used within a WorkspaceOverlayProvider');
  }
  return context;
}

export function useShowModal<MId extends ModalId>(id: MId) {
  const { showModal } = useModalContext();
  return (args: UserArgs<MId>) => showModal(id, args);
}

export function useTransitionModal<MId extends ModalId>(id: MId) {
  const { transitionModal } = useModalContext();
  return (args: UserArgs<MId>) => transitionModal(id, args);
}
