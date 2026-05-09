import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels';
import { panelDragStore } from './panel-drag-store';

export interface WorkspaceLayoutContextValue {
  isLeftOpen: boolean;
  leftPanelRef: RefObject<PanelImperativeHandle | null>;
  setIsLeftOpen: (open: boolean) => void;
  handleDragging: (side: 'left', dragging: boolean) => void;
  setCollapsed: (side: 'left', collapsed: boolean) => void;
  toggleLeft: () => void;
}

const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextValue | undefined>(undefined);

export function useWorkspaceLayoutService() {
  const leftPanelRef = usePanelRef();

  const [isLeftOpen, setIsLeftOpen] = useState(true);

  const draggingRef = useRef({ left: false });

  const handleDragging = useCallback((side: 'left', dragging: boolean) => {
    if (draggingRef.current[side] === dragging) return;
    const wasDragging = draggingRef.current.left;
    draggingRef.current[side] = dragging;
    const isDragging = draggingRef.current.left;
    if (wasDragging !== isDragging) {
      panelDragStore.setDragging(isDragging);
    }
  }, []);

  useEffect(() => {
    const dragging = draggingRef.current;
    return () => {
      if (dragging.left) {
        panelDragStore.setDragging(false);
      }
    };
  }, []);

  const setCollapsed = useCallback(
    (side: 'left', collapsed: boolean) => {
      const panel = leftPanelRef.current;
      if (panel) {
        if (collapsed) {
          panel.collapse();
        } else {
          panel.expand();
        }
      }
    },
    [leftPanelRef]
  );

  const toggleLeft = useCallback(() => {
    setCollapsed('left', isLeftOpen);
  }, [setCollapsed, isLeftOpen]);

  return {
    leftPanelRef,
    handleDragging,
    setIsLeftOpen,
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
