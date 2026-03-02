import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { CloneFromUrlModal } from '@/components/CloneFromUrlModal';
import { NewProjectModal } from '@/components/NewProjectModal';
import { UpdateModalOverlay } from '@/components/UpdateModal';
import { TaskModalOverlay } from '@/components/TaskModal';
import { AddRemoteProjectModal } from '@/components/ssh/AddRemoteProjectModal';
import { GithubDeviceFlowModalOverlay } from '@/components/GithubDeviceFlowModal';

// Define overlays here so we can use them in the showOverlay function
const overlayRegistry = {
  updateModal: UpdateModalOverlay,
  newProjectModal: NewProjectModal,
  cloneFromUrlModal: CloneFromUrlModal,
  taskModal: TaskModalOverlay,
  addRemoteProjectModal: AddRemoteProjectModal,
  githubDeviceFlowModal: GithubDeviceFlowModalOverlay,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} satisfies Record<string, OverlayComponent<any, any>>;

export interface OverlayProps<TResult = unknown> {
  onSuccess: (result: TResult) => void;
  onClose: () => void;
}

type UserArgs<OId extends OverlayId> = Omit<OverlayArgs<OId>, 'onSuccess' | 'onClose'> & {
  onSuccess?: (
    result: OverlayArgs<OId> extends { onSuccess: (result: infer R) => void } ? R : unknown
  ) => void;
  onClose?: () => void;
};

type OverlayComponent<TProps = unknown, TResult = unknown> = (
  props: TProps & OverlayProps<TResult>
) => ReactNode;

type OverlayId = keyof typeof overlayRegistry;

type OverlayArgs<TId extends OverlayId> = Parameters<(typeof overlayRegistry)[TId]>[0];

type WorkspaceOverlayContext = {
  activeOverlayId: OverlayId | null;
  renderOverlay: () => ReactNode;
  closeOverlay: () => void;
  showOverlay: <TId extends OverlayId>(overlay: TId, args: UserArgs<TId>) => void;
};

const WorkspaceOverlayContext = createContext<WorkspaceOverlayContext | undefined>(undefined);

export function WorkspaceOverlayProvider({ children }: { children: ReactNode }) {
  const [activeOverlayId, setActiveOverlayId] = useState<OverlayId | null>(null);
  const activeOverlayArgs = useRef<OverlayArgs<OverlayId> | null>(null);

  const renderOverlay = useCallback((): ReactNode => {
    if (!activeOverlayId || !activeOverlayArgs.current) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = overlayRegistry[activeOverlayId] as React.ComponentType<any>;
    return <Component {...activeOverlayArgs.current} />;
  }, [activeOverlayId]);

  const dispatchOverlayEvent = (open: boolean) => {
    window.dispatchEvent(new CustomEvent('emdash:overlay:changed', { detail: { open } }));
  };

  const closeOverlay = useCallback(() => {
    setActiveOverlayId(null);
    activeOverlayArgs.current = null;
    dispatchOverlayEvent(false);
  }, [setActiveOverlayId, activeOverlayArgs]);

  const showOverlay = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <TId extends OverlayId>(id: TId, args: UserArgs<TId>) => {
      const wrappedArgs = {
        ...args,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSuccess: (result: any) => {
          args.onSuccess?.(result);
          closeOverlay();
        },
        onClose: () => {
          args.onClose?.();
          closeOverlay();
        },
      };
      setActiveOverlayId(id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activeOverlayArgs.current = wrappedArgs as any;
      dispatchOverlayEvent(true);
    },
    [setActiveOverlayId, activeOverlayArgs, closeOverlay]
  );

  return (
    <WorkspaceOverlayContext.Provider
      value={{ activeOverlayId, renderOverlay, closeOverlay, showOverlay }}
    >
      {children}
    </WorkspaceOverlayContext.Provider>
  );
}

export function useWorkspaceOverlayContext() {
  const context = useContext(WorkspaceOverlayContext);
  if (!context) {
    throw new Error('useWorkspaceOverlayContext must be used within a WorkspaceOverlayProvider');
  }
  return context;
}

export function useShowOverlay<OId extends OverlayId>(id: OId) {
  const { showOverlay } = useWorkspaceOverlayContext();
  return (args: UserArgs<OId>) => showOverlay(id, args);
}
