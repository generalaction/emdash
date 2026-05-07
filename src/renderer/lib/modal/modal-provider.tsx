import { runInAction } from 'mobx';
import { useObserver } from 'mobx-react-lite';
import { useCallback, type ReactNode } from 'react';
import { type modalRegistry } from '@renderer/app/modal-registry';
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

export function useModalContext() {
  const showModal = useCallback(<TId extends ModalId>(id: TId, args: UserArgs<TId>) => {
    modalStore.setModal(id, wrapArgs(args));
    window.dispatchEvent(new CustomEvent('emdash:overlay:changed', { detail: { open: true } }));
  }, []);

  const transitionModal = useCallback(<TId extends ModalId>(id: TId, args: UserArgs<TId>) => {
    modalStore.setModal(id, wrapArgs(args));
    // No overlay event — the dialog stays open; AnimatedHeight handles the content swap.
  }, []);

  const closeModal = useCallback(() => modalStore.closeModal('dismissed'), []);

  const setCloseGuard = useCallback((active: boolean) => {
    runInAction(() => {
      modalStore.closeGuardActive = active;
    });
  }, []);

  const hasActiveCloseGuard = useObserver(() => modalStore.closeGuardActive);

  return { closeModal, showModal, transitionModal, hasActiveCloseGuard, setCloseGuard };
}

export function useShowModal<MId extends ModalId>(id: MId) {
  return useCallback(
    (args: UserArgs<MId>) => {
      modalStore.setModal(id, wrapArgs(args));
      window.dispatchEvent(new CustomEvent('emdash:overlay:changed', { detail: { open: true } }));
    },
    [id]
  );
}

export function useTransitionModal<MId extends ModalId>(id: MId) {
  return useCallback(
    (args: UserArgs<MId>) => {
      modalStore.setModal(id, wrapArgs(args));
    },
    [id]
  );
}
