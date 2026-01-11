import { useCallback, useEffect, useRef, useState } from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { loadPanelSizes, savePanelSizes } from '../lib/persisted-layout';

const PANEL_LAYOUT_STORAGE_KEY = 'emdash.layout.left-main-right.v2';
const DEFAULT_PANEL_LAYOUT: [number, number, number] = [20, 60, 20];
const LEFT_SIDEBAR_MIN_SIZE = 16;
const LEFT_SIDEBAR_MAX_SIZE = 30;
const RIGHT_SIDEBAR_MIN_SIZE = 16;
const RIGHT_SIDEBAR_MAX_SIZE = 50;
const MAIN_PANEL_MIN_SIZE = 30;

const clampLeftSidebarSize = (value: number) =>
  Math.min(
    Math.max(Number.isFinite(value) ? value : DEFAULT_PANEL_LAYOUT[0], LEFT_SIDEBAR_MIN_SIZE),
    LEFT_SIDEBAR_MAX_SIZE
  );

const clampRightSidebarSize = (value: number) =>
  Math.min(
    Math.max(Number.isFinite(value) ? value : DEFAULT_PANEL_LAYOUT[2], RIGHT_SIDEBAR_MIN_SIZE),
    RIGHT_SIDEBAR_MAX_SIZE
  );

export interface PanelLayoutState {
  defaultPanelLayout: [number, number, number];
  rightSidebarDefaultWidth: number;
  leftSidebarPanelRef: React.MutableRefObject<ImperativePanelHandle | null>;
  rightSidebarPanelRef: React.MutableRefObject<ImperativePanelHandle | null>;
  lastLeftSidebarSizeRef: React.MutableRefObject<number>;
  leftSidebarWasCollapsedBeforeEditor: React.MutableRefObject<boolean>;
  lastRightSidebarSizeRef: React.MutableRefObject<number>;
  leftSidebarSetOpenRef: React.MutableRefObject<((next: boolean) => void) | null>;
  leftSidebarIsMobileRef: React.MutableRefObject<boolean>;
  leftSidebarOpenRef: React.MutableRefObject<boolean>;
  rightSidebarSetCollapsedRef: React.MutableRefObject<((next: boolean) => void) | null>;
  rightSidebarCollapsed: boolean;
  setRightSidebarCollapsed: (collapsed: boolean) => void;
  autoRightSidebarBehavior: boolean;
  setAutoRightSidebarBehavior: (enabled: boolean) => void;
}

export interface PanelLayoutHandlers {
  handlePanelLayout: (sizes: number[]) => void;
  handleSidebarContextChange: (args: {
    open: boolean;
    isMobile: boolean;
    setOpen: (next: boolean) => void;
  }) => void;
}

export function usePanelLayout(showEditorMode: boolean): PanelLayoutState & PanelLayoutHandlers {
  const defaultPanelLayout = (() => {
    const stored = loadPanelSizes(PANEL_LAYOUT_STORAGE_KEY, DEFAULT_PANEL_LAYOUT);
    const [storedLeft = DEFAULT_PANEL_LAYOUT[0], , storedRight = DEFAULT_PANEL_LAYOUT[2]] =
      Array.isArray(stored) && stored.length === 3
        ? (stored as [number, number, number])
        : DEFAULT_PANEL_LAYOUT;
    const left = clampLeftSidebarSize(storedLeft);
    const right = clampRightSidebarSize(storedRight);
    const middle = Math.max(0, 100 - left - right);
    return [left, middle, right] as [number, number, number];
  })();

  const rightSidebarDefaultWidth = clampRightSidebarSize(defaultPanelLayout[2]);

  const leftSidebarPanelRef = useRef<ImperativePanelHandle | null>(null);
  const rightSidebarPanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastLeftSidebarSizeRef = useRef<number>(defaultPanelLayout[0]);
  const leftSidebarWasCollapsedBeforeEditor = useRef<boolean>(false);
  const lastRightSidebarSizeRef = useRef<number>(rightSidebarDefaultWidth);
  const leftSidebarSetOpenRef = useRef<((next: boolean) => void) | null>(null);
  const leftSidebarIsMobileRef = useRef<boolean>(false);
  const leftSidebarOpenRef = useRef<boolean>(true);
  const rightSidebarSetCollapsedRef = useRef<((next: boolean) => void) | null>(null);

  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState<boolean>(false);
  const [autoRightSidebarBehavior, setAutoRightSidebarBehavior] = useState<boolean>(false);

  const handlePanelLayout = useCallback((sizes: number[]) => {
    if (!Array.isArray(sizes) || sizes.length < 3) {
      return;
    }

    if (leftSidebarIsMobileRef.current) {
      return;
    }

    const [leftSize, , rightSize] = sizes;
    const rightCollapsed = typeof rightSize === 'number' && rightSize <= 0.5;

    let storedLeft = lastLeftSidebarSizeRef.current;
    if (typeof leftSize === 'number') {
      if (leftSize <= 0.5) {
        leftSidebarSetOpenRef.current?.(false);
        leftSidebarOpenRef.current = false;
      } else {
        leftSidebarSetOpenRef.current?.(true);
        leftSidebarOpenRef.current = true;
        if (!rightCollapsed) {
          storedLeft = clampLeftSidebarSize(leftSize);
          lastLeftSidebarSizeRef.current = storedLeft;
        }
      }
    }

    let storedRight = lastRightSidebarSizeRef.current;
    if (typeof rightSize === 'number') {
      if (rightSize <= 0.5) {
        rightSidebarSetCollapsedRef.current?.(true);
      } else {
        storedRight = clampRightSidebarSize(rightSize);
        lastRightSidebarSizeRef.current = storedRight;
        rightSidebarSetCollapsedRef.current?.(false);
      }
    }

    const middle = Math.max(0, 100 - storedLeft - storedRight);
    savePanelSizes(PANEL_LAYOUT_STORAGE_KEY, [storedLeft, middle, storedRight]);
  }, []);

  const handleSidebarContextChange = useCallback(
    ({
      open,
      isMobile,
      setOpen,
    }: {
      open: boolean;
      isMobile: boolean;
      setOpen: (next: boolean) => void;
    }) => {
      leftSidebarSetOpenRef.current = setOpen;
      leftSidebarIsMobileRef.current = isMobile;
      leftSidebarOpenRef.current = open;
      const panel = leftSidebarPanelRef.current;
      if (!panel) {
        return;
      }

      // Prevent sidebar from opening when in editor mode
      if (showEditorMode && open) {
        setOpen(false);
        return;
      }

      if (isMobile) {
        const currentSize = panel.getSize();
        if (typeof currentSize === 'number' && currentSize > 0) {
          lastLeftSidebarSizeRef.current = clampLeftSidebarSize(currentSize);
        }
        panel.collapse();
        return;
      }

      if (open) {
        const target = clampLeftSidebarSize(lastLeftSidebarSizeRef.current || DEFAULT_PANEL_LAYOUT[0]);
        panel.expand();
        panel.resize(target);
      } else {
        const currentSize = panel.getSize();
        if (typeof currentSize === 'number' && currentSize > 0) {
          lastLeftSidebarSizeRef.current = clampLeftSidebarSize(currentSize);
        }
        panel.collapse();
      }
    },
    [showEditorMode]
  );

  // Handle left sidebar visibility when Editor mode changes
  useEffect(() => {
    const panel = leftSidebarPanelRef.current;
    if (!panel) return;

    if (showEditorMode) {
      leftSidebarWasCollapsedBeforeEditor.current = panel.isCollapsed();
      if (!panel.isCollapsed()) {
        panel.collapse();
      }
    } else {
      if (!leftSidebarWasCollapsedBeforeEditor.current && panel.isCollapsed()) {
        panel.expand();
      }
    }
  }, [showEditorMode]);

  // Load autoRightSidebarBehavior setting on mount and listen for changes
  useEffect(() => {
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (result.success && result.settings) {
          setAutoRightSidebarBehavior(Boolean(result.settings.interface?.autoRightSidebarBehavior ?? false));
        }
      } catch (error) {
        console.error('Failed to load right sidebar settings:', error);
      }
    })();

    const handleSettingChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled: boolean }>;
      setAutoRightSidebarBehavior(customEvent.detail.enabled);
    };
    window.addEventListener('autoRightSidebarBehaviorChanged', handleSettingChange);
    return () => {
      window.removeEventListener('autoRightSidebarBehaviorChanged', handleSettingChange);
    };
  }, []);

  // Manage right sidebar collapse/expand on panel resize
  useEffect(() => {
    const rightPanel = rightSidebarPanelRef.current;
    if (rightPanel) {
      if (rightSidebarCollapsed) {
        rightPanel.collapse();
      } else {
        const targetRight = clampRightSidebarSize(lastRightSidebarSizeRef.current || DEFAULT_PANEL_LAYOUT[2]);
        lastRightSidebarSizeRef.current = targetRight;
        rightPanel.expand();
        rightPanel.resize(targetRight);
      }
    }

    if (leftSidebarIsMobileRef.current || !leftSidebarOpenRef.current) {
      return;
    }

    const leftPanel = leftSidebarPanelRef.current;
    if (!leftPanel) {
      return;
    }

    const targetLeft = clampLeftSidebarSize(lastLeftSidebarSizeRef.current || DEFAULT_PANEL_LAYOUT[0]);
    lastLeftSidebarSizeRef.current = targetLeft;
    leftPanel.expand();
    leftPanel.resize(targetLeft);
  }, [rightSidebarCollapsed]);

  return {
    defaultPanelLayout,
    rightSidebarDefaultWidth,
    leftSidebarPanelRef,
    rightSidebarPanelRef,
    lastLeftSidebarSizeRef,
    leftSidebarWasCollapsedBeforeEditor,
    lastRightSidebarSizeRef,
    leftSidebarSetOpenRef,
    leftSidebarIsMobileRef,
    leftSidebarOpenRef,
    rightSidebarSetCollapsedRef,
    rightSidebarCollapsed,
    setRightSidebarCollapsed,
    autoRightSidebarBehavior,
    setAutoRightSidebarBehavior,
    handlePanelLayout,
    handleSidebarContextChange,
  };
}

export const PANEL_CONSTANTS = {
  TITLEBAR_HEIGHT: '36px',
  LEFT_SIDEBAR_MIN_SIZE,
  LEFT_SIDEBAR_MAX_SIZE,
  RIGHT_SIDEBAR_MIN_SIZE,
  RIGHT_SIDEBAR_MAX_SIZE,
  MAIN_PANEL_MIN_SIZE,
};
