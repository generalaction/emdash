import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { loadPanelSizes, savePanelSizes } from '../lib/persisted-layout';
import {
  PANEL_LAYOUT_STORAGE_KEY,
  DEFAULT_PANEL_LAYOUT,
  clampLeftSidebarSize,
  clampRightSidebarSize,
} from '../constants/layout';

export interface UsePanelLayoutOptions {
  showEditorMode: boolean;
  showDiffViewer: boolean;
  isInitialLoadComplete: boolean;
  showHomeView: boolean;
  selectedProject: { id: string } | null;
  activeTask: { id: string } | null;
}

export function usePanelLayout(opts: UsePanelLayoutOptions) {
  const {
    showEditorMode,
    showDiffViewer,
    isInitialLoadComplete,
    showHomeView,
    selectedProject,
    activeTask,
  } = opts;

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

  const leftSidebarPanelRef = useRef<ImperativePanelHandle | null>(null);
  const rightSidebarPanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastLeftSidebarSizeRef = useRef<number>(defaultPanelLayout[0]);
  const leftSidebarWasCollapsedBeforeEditor = useRef<boolean>(false);
  const leftSidebarWasCollapsedBeforeDiffViewer = useRef<boolean>(false);
  const rightSidebarWasCollapsedBeforeDiffViewer = useRef<boolean>(false);
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

  // Handle both sidebars visibility when Diff Viewer opens/closes
  useEffect(() => {
    const leftPanel = leftSidebarPanelRef.current;
    const rightPanel = rightSidebarPanelRef.current;

    if (showDiffViewer) {
      // Save and collapse left sidebar
      if (leftPanel) {
        leftSidebarWasCollapsedBeforeDiffViewer.current = leftPanel.isCollapsed();
        if (!leftPanel.isCollapsed()) {
          leftPanel.collapse();
        }
      }
      // Save and collapse right sidebar
      if (rightPanel) {
        rightSidebarWasCollapsedBeforeDiffViewer.current = rightPanel.isCollapsed();
        if (!rightPanel.isCollapsed()) {
          rightPanel.collapse();
        }
      }
    } else {
      // Restore left sidebar
      if (
        leftPanel &&
        !leftSidebarWasCollapsedBeforeDiffViewer.current &&
        leftPanel.isCollapsed()
      ) {
        leftPanel.expand();
      }
      // Restore right sidebar
      if (
        rightPanel &&
        !rightSidebarWasCollapsedBeforeDiffViewer.current &&
        rightPanel.isCollapsed()
      ) {
        const targetRight = clampRightSidebarSize(
          lastRightSidebarSizeRef.current || DEFAULT_PANEL_LAYOUT[2]
        );
        rightPanel.expand();
        rightPanel.resize(targetRight);
      }
    }
  }, [showDiffViewer]);

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

  // Auto-collapse/expand right sidebar based on current view
  useEffect(() => {
    // Defer sidebar behavior until initial load completes to prevent flash
    if (!autoRightSidebarBehavior || !isInitialLoadComplete) return;

    const isHomePage = showHomeView;
    const isRepoHomePage = selectedProject !== null && activeTask === null;
    const shouldCollapse = isHomePage || isRepoHomePage;

    if (shouldCollapse) {
      rightSidebarSetCollapsedRef.current?.(true);
    } else if (activeTask !== null) {
      rightSidebarSetCollapsedRef.current?.(false);
    }
  }, [autoRightSidebarBehavior, isInitialLoadComplete, showHomeView, selectedProject, activeTask]);

  // Sync right sidebar panel with collapsed state
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
    defaultPanelLayout,
    leftSidebarPanelRef,
    rightSidebarPanelRef,
    rightSidebarSetCollapsedRef,
    rightSidebarCollapsed,
    handlePanelLayout,
    handleSidebarContextChange,
    handleRightSidebarCollapsedChange,
  };
}
