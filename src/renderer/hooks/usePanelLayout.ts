import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import {
  clampLeftSidebarSize,
  clampRightSidebarSize,
  DEFAULT_PANEL_LAYOUT,
  LEFT_SIDEBAR_MAX_SIZE,
  LEFT_SIDEBAR_MIN_SIZE,
  PANEL_LAYOUT_STORAGE_KEY,
  RIGHT_SIDEBAR_MAX_SIZE,
  RIGHT_SIDEBAR_MIN_SIZE,
} from '../constants/layout';
import { loadPanelSizes, savePanelSizes } from '../lib/persisted-layout';

/**
 * Hook to manage panel layout state and behavior
 * Handles sidebar collapsing, expanding, and size persistence
 */

export interface PanelLayoutState {
  defaultPanelLayout: [number, number, number];
  rightSidebarDefaultWidth: number;
  rightSidebarCollapsed: boolean;
  autoRightSidebarBehavior: boolean;
  leftSidebarPanelRef: React.MutableRefObject<ImperativePanelHandle | null>;
  rightSidebarPanelRef: React.MutableRefObject<ImperativePanelHandle | null>;
  rightSidebarSetCollapsedRef: React.MutableRefObject<((next: boolean) => void) | null>;
}

export interface PanelLayoutActions {
  handlePanelLayout: (sizes: number[]) => void;
  handleSidebarContextChange: (context: {
    open: boolean;
    isMobile: boolean;
    setOpen: (next: boolean) => void;
  }) => void;
  handleRightSidebarCollapsedChange: (collapsed: boolean) => void;
  setAutoRightSidebarBehavior: (enabled: boolean) => void;
}

interface UsePanelLayoutOptions {
  showEditorMode?: boolean;
  showHomeView?: boolean;
  selectedProject?: any | null;
  activeTask?: any | null;
}

export function usePanelLayout(options: UsePanelLayoutOptions = {}): PanelLayoutState & PanelLayoutActions {
  const { showEditorMode = false, showHomeView = false, selectedProject = null, activeTask = null } = options;

  // Load initial panel layout from storage
  const defaultPanelLayout = useMemo(() => {
    const stored = loadPanelSizes(PANEL_LAYOUT_STORAGE_KEY, DEFAULT_PANEL_LAYOUT);
    const [storedLeft = DEFAULT_PANEL_LAYOUT[0], , storedRight = DEFAULT_PANEL_LAYOUT[2]] =
      Array.isArray(stored) && stored.length === 3
        ? (stored as [number, number, number])
        : DEFAULT_PANEL_LAYOUT;
    const left = clampLeftSidebarSize(storedLeft);
    const right = clampRightSidebarSize(storedRight);
    const middle = Math.max(0, 100 - left - right);
    return [left, middle, right] as [number, number, number];
  }, []);

  const rightSidebarDefaultWidth = useMemo(
    () => clampRightSidebarSize(defaultPanelLayout[2]),
    [defaultPanelLayout]
  );

  // Panel refs
  const leftSidebarPanelRef = useRef<ImperativePanelHandle | null>(null);
  const rightSidebarPanelRef = useRef<ImperativePanelHandle | null>(null);

  // Size tracking refs
  const lastLeftSidebarSizeRef = useRef<number>(defaultPanelLayout[0]);
  const lastRightSidebarSizeRef = useRef<number>(rightSidebarDefaultWidth);

  // Left sidebar state refs
  const leftSidebarSetOpenRef = useRef<((next: boolean) => void) | null>(null);
  const leftSidebarIsMobileRef = useRef<boolean>(false);
  const leftSidebarOpenRef = useRef<boolean>(true);
  const leftSidebarWasCollapsedBeforeEditor = useRef<boolean>(false);

  // Right sidebar state
  const rightSidebarSetCollapsedRef = useRef<((next: boolean) => void) | null>(null);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState<boolean>(false);
  const [autoRightSidebarBehavior, setAutoRightSidebarBehavior] = useState<boolean>(false);

  // Handle panel layout changes
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

  // Handle sidebar context changes
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
        const target = clampLeftSidebarSize(
          lastLeftSidebarSizeRef.current || DEFAULT_PANEL_LAYOUT[0]
        );
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

  const handleRightSidebarCollapsedChange = useCallback((collapsed: boolean) => {
    setRightSidebarCollapsed(collapsed);
  }, []);

  // Handle left sidebar visibility when Editor mode changes
  useEffect(() => {
    const panel = leftSidebarPanelRef.current;
    if (!panel) return;

    if (showEditorMode) {
      // Store current collapsed state before hiding
      leftSidebarWasCollapsedBeforeEditor.current = panel.isCollapsed();
      // Collapse the left sidebar when Editor mode opens
      if (!panel.isCollapsed()) {
        panel.collapse();
      }
    } else {
      // Restore previous state when Editor mode closes
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
          setAutoRightSidebarBehavior(
            Boolean(result.settings.interface?.autoRightSidebarBehavior ?? false)
          );
        }
      } catch (error) {
        console.error('Failed to load right sidebar settings:', error);
      }
    })();

    // Listen for setting changes from RightSidebarSettingsCard
    const handleSettingChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled: boolean }>;
      setAutoRightSidebarBehavior(customEvent.detail.enabled);
    };
    window.addEventListener('autoRightSidebarBehaviorChanged', handleSettingChange);
    return () => {
      window.removeEventListener('autoRightSidebarBehaviorChanged', handleSettingChange);
    };
  }, []);

  // Auto-collapse/expand right sidebar based on current view (no animation)
  useEffect(() => {
    if (!autoRightSidebarBehavior) return;

    // On home page or repo home page (no active task), collapse the sidebar
    const isHomePage = showHomeView;
    const isRepoHomePage = selectedProject !== null && activeTask === null;

    const shouldCollapse = isHomePage || isRepoHomePage;
    const shouldExpand = activeTask !== null;

    if (shouldCollapse || shouldExpand) {
      // Add no-transition class to skip animation
      const panelGroup = document.querySelector('[data-panel-group]');
      panelGroup?.classList.add('no-transition');

      if (shouldCollapse) {
        rightSidebarSetCollapsedRef.current?.(true);
      } else if (shouldExpand) {
        rightSidebarSetCollapsedRef.current?.(false);
      }

      // Remove the class after a frame to allow future animations
      requestAnimationFrame(() => {
        panelGroup?.classList.remove('no-transition');
      });
    }
  }, [autoRightSidebarBehavior, showHomeView, selectedProject, activeTask]);

  // Sync right sidebar collapsed state with panel
  useEffect(() => {
    const rightPanel = rightSidebarPanelRef.current;
    if (rightPanel) {
      if (rightSidebarCollapsed) {
        rightPanel.collapse();
      } else {
        const targetRight = clampRightSidebarSize(
          lastRightSidebarSizeRef.current || DEFAULT_PANEL_LAYOUT[2]
        );
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

    const targetLeft = clampLeftSidebarSize(
      lastLeftSidebarSizeRef.current || DEFAULT_PANEL_LAYOUT[0]
    );
    lastLeftSidebarSizeRef.current = targetLeft;
    leftPanel.expand();
    leftPanel.resize(targetLeft);
  }, [rightSidebarCollapsed]);

  return {
    // State
    defaultPanelLayout,
    rightSidebarDefaultWidth,
    rightSidebarCollapsed,
    autoRightSidebarBehavior,
    leftSidebarPanelRef,
    rightSidebarPanelRef,
    rightSidebarSetCollapsedRef,

    // Actions
    handlePanelLayout,
    handleSidebarContextChange,
    handleRightSidebarCollapsedChange,
    setAutoRightSidebarBehavior,
  };
}