import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { AddProjectModal } from '@renderer/components/add-project-modal/add-project-modal';
import { CloneFromUrlModal } from '@renderer/components/CloneFromUrlModal';
import { CommandPaletteModal } from '@renderer/components/CommandPaletteModal';
import { GithubDeviceFlowModalOverlay } from '@renderer/components/GithubDeviceFlowModal';
import { NewProjectModal } from '@renderer/components/NewProjectModal';
import { AddRemoteProjectModal } from '@renderer/components/ssh/AddRemoteProjectModal';
import { TaskModalOverlay } from '@renderer/components/TaskModal';
import { UpdateModalOverlay } from '@renderer/components/UpdateModal';

// Define overlays here so we can use them in the showOverlay function
const modalRegistry = {
  updateModal: UpdateModalOverlay,
  newProjectModal: NewProjectModal,
  cloneFromUrlModal: CloneFromUrlModal,
  taskModal: TaskModalOverlay,
  addProjectModal: AddProjectModal,
  addRemoteProjectModal: AddRemoteProjectModal,
  githubDeviceFlowModal: GithubDeviceFlowModalOverlay,
  commandPaletteModal: CommandPaletteModal,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, ModalComponent<any, any>>;

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

type ModalComponent<TProps = unknown, TResult = unknown> = (
  props: TProps & BaseModalProps<TResult>
) => ReactNode;

type ModalId = keyof typeof modalRegistry;

type ModalArgs<TId extends ModalId> = Parameters<(typeof modalRegistry)[TId]>[0];

type ModalContext = {
  activeModalId: ModalId | null;
  renderModal: () => ReactNode;
  closeModal: () => void;
  showModal: <TId extends ModalId>(modal: TId, args: UserArgs<TId>) => void;
  hasActiveCloseGuard: boolean;
  setCloseGuard: (active: boolean) => void;
};

const ModalContext = createContext<ModalContext | undefined>(undefined);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [activeModalId, setActiveModalId] = useState<ModalId | null>(null);
  const activeModalArgs = useRef<ModalArgs<ModalId> | null>(null);
  const [closeGuardActive, setCloseGuardActive] = useState(false);

  const renderModal = useCallback((): ReactNode => {
    if (!activeModalId || !activeModalArgs.current) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = modalRegistry[activeModalId] as React.ComponentType<any>;
    return <Component {...activeModalArgs.current} />;
  }, [activeModalId]);

  const dispatchOverlayEvent = (open: boolean) => {
    window.dispatchEvent(new CustomEvent('emdash:overlay:changed', { detail: { open } }));
  };

  const closeModal = useCallback(() => {
    setCloseGuardActive(false);
    setActiveModalId(null);
    activeModalArgs.current = null;
    dispatchOverlayEvent(false);
  }, [setActiveModalId, activeModalArgs]);

  const showModal = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <TId extends ModalId>(id: TId, args: UserArgs<TId>) => {
      const wrappedArgs = {
        ...args,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSuccess: (result: any) => {
          args.onSuccess?.(result);
          closeModal();
        },
        onClose: () => {
          args.onClose?.();
          closeModal();
        },
      };
      setActiveModalId(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activeModalArgs.current = wrappedArgs as any;
      dispatchOverlayEvent(true);
    },
    [setActiveModalId, activeModalArgs, closeModal]
  );

  return (
    <ModalContext.Provider
      value={{
        activeModalId: activeModalId,
        renderModal: renderModal,
        closeModal: closeModal,
        showModal: showModal,
        hasActiveCloseGuard: closeGuardActive,
        setCloseGuard: setCloseGuardActive,
      }}
    >
      {children}
    </ModalContext.Provider>
  );
}

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
