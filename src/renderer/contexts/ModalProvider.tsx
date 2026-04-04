import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { CloneFromUrlModal } from '@/components/CloneFromUrlModal';
import { NewProjectModal } from '@/components/NewProjectModal';
import { UpdateModalOverlay } from '@/components/UpdateModal';
import { TaskModalOverlay } from '@/components/TaskModal';
import { AddRemoteProjectModal } from '@/components/ssh/AddRemoteProjectModal';
import { GithubDeviceFlowModalOverlay } from '@/components/GithubDeviceFlowModal';
import { McpServerModal } from '@/components/mcp/McpServerModal';
import { ChangelogModalOverlay } from '@/components/ChangelogModal';
import { AIReviewConfigModalOverlay } from '@/components/AIReviewConfigModal';
import { AIReviewResultsModalOverlay } from '@/components/AIReviewResultsModal';

// Define overlays here so we can use them in the showOverlay function
const modalRegistry = {
  changelogModal: ChangelogModalOverlay,
  updateModal: UpdateModalOverlay,
  newProjectModal: NewProjectModal,
  cloneFromUrlModal: CloneFromUrlModal,
  taskModal: TaskModalOverlay,
  addRemoteProjectModal: AddRemoteProjectModal,
  githubDeviceFlowModal: GithubDeviceFlowModalOverlay,
  mcpServerModal: McpServerModal,
  aiReviewConfigModal: AIReviewConfigModalOverlay,
  aiReviewResultsModal: AIReviewResultsModalOverlay,
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
};

const ModalContext = createContext<ModalContext | undefined>(undefined);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [activeModalId, setActiveModalId] = useState<ModalId | null>(null);
  const activeModalArgs = useRef<ModalArgs<ModalId> | null>(null);

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
