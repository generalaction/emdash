import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels';

export interface WorkspaceLayoutContextValue {
  isLeftOpen: boolean;
  leftPanelRef: RefObject<PanelImperativeHandle | null>;
  syncLeftOpenFromPanel: () => void;
  setCollapsed: (side: 'left', collapsed: boolean) => void;
  toggleLeft: () => void;
}

const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextValue | undefined>(undefined);

export function useWorkspaceLayoutService() {
  const leftPanelRef = usePanelRef();

  const [isLeftOpen, setIsLeftOpen] = useState(true);

  // Guard so the panel's onResize callback doesn't clobber isLeftOpen while a
  // programmatic collapse/expand is in flight (state-only concern, no resize
  // suppression needed because the ResizeObserver is now always trusted).
  const programmaticRef = useRef(false);

  const syncLeftOpenFromPanel = useCallback(() => {
    if (programmaticRef.current) return;
    setIsLeftOpen(!leftPanelRef.current?.isCollapsed());
  }, [leftPanelRef]);

  const setCollapsed = useCallback(
    (side: 'left', collapsed: boolean) => {
      const panel = leftPanelRef.current;
      if (!panel) return;
      programmaticRef.current = true;
      setIsLeftOpen(!collapsed);
      if (collapsed) {
        panel.collapse();
      } else {
        panel.expand();
      }
      // Clear the guard on the next frame once the panel has settled.
      requestAnimationFrame(() => {
        programmaticRef.current = false;
      });
    },
    [leftPanelRef]
  );

  const toggleLeft = useCallback(() => {
    setCollapsed('left', isLeftOpen);
  }, [setCollapsed, isLeftOpen]);

  return {
    leftPanelRef,
    syncLeftOpenFromPanel,
    isLeftOpen,
    setCollapsed,
    toggleLeft,
  };
}

export function WorkspaceLayoutContextProvider({ children }: { children: ReactNode }) {
  const value = useWorkspaceLayoutService();
  return (
    <WorkspaceLayoutContext.Provider value={value}>{children}</WorkspaceLayoutContext.Provider>
  );
}

export function useWorkspaceLayoutContext() {
  const context = useContext(WorkspaceLayoutContext);
  if (!context) {
    throw new Error(
      'useWorkspaceLayoutContext must be used within a WorkspaceLayoutContextProvider'
    );
  }
  return context;
}
