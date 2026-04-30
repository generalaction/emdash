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
  isRightOpen: boolean;
  leftPanelRef: RefObject<PanelImperativeHandle | null>;
  rightPanelRef: RefObject<PanelImperativeHandle | null>;
  setIsLeftOpen: (open: boolean) => void;
  setIsRightOpen: (open: boolean) => void;
  handleDragging: (side: 'left' | 'right', dragging: boolean) => void;
  setCollapsed: (side: 'left' | 'right', collapsed: boolean) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
}

const WorkspaceLayoutContext = createContext<WorkspaceLayoutContextValue | undefined>(undefined);

export function useWorkspaceLayoutService() {
  const leftPanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();

  const [isLeftOpen, setIsLeftOpen] = useState(true);
  const [isRightOpen, setIsRightOpen] = useState(true);

  const draggingRef = useRef({ left: false, right: false });

  const handleDragging = useCallback((side: 'left' | 'right', dragging: boolean) => {
    if (draggingRef.current[side] === dragging) return;
    const wasDragging = draggingRef.current.left || draggingRef.current.right;
    draggingRef.current[side] = dragging;
    const isDragging = draggingRef.current.left || draggingRef.current.right;
    if (wasDragging !== isDragging) {
      panelDragStore.setDragging(isDragging);
    }
  }, []);

  useEffect(() => {
    const dragging = draggingRef.current;
    return () => {
      if (dragging.left || dragging.right) {
        panelDragStore.setDragging(false);
      }
    };
  }, []);

  const setCollapsed = useCallback(
    (side: 'left' | 'right', collapsed: boolean) => {
      const panel = side === 'left' ? leftPanelRef.current : rightPanelRef.current;
      if (panel) {
        if (collapsed) {
          panel.collapse();
        } else {
          panel.expand();
        }
      }
    },
    [leftPanelRef, rightPanelRef]
  );

  const toggleLeft = useCallback(() => {
    setCollapsed('left', isLeftOpen);
  }, [setCollapsed, isLeftOpen]);

  const toggleRight = useCallback(() => {
    setCollapsed('right', isRightOpen);
  }, [setCollapsed, isRightOpen]);

  return {
    leftPanelRef,
    rightPanelRef,
    handleDragging,
    setIsLeftOpen,
    setIsRightOpen,
    isLeftOpen,
    isRightOpen,
    setCollapsed,
    toggleLeft,
    toggleRight,
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
