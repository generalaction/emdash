import { useCallback, useEffect, useState } from 'react';
import type { SettingsTab } from '../components/SettingsModal';
import { FIRST_LAUNCH_KEY } from '../constants/layout';

export interface ModalState {
  showSettings: boolean;
  settingsInitialTab: SettingsTab;
  showCommandPalette: boolean;
  showWelcomeScreen: boolean;
  showFirstLaunchModal: boolean;
  showTaskModal: boolean;
  showNewProjectModal: boolean;
  showCloneModal: boolean;
  showEditorMode: boolean;
  showKanban: boolean;
  showDeviceFlowModal: boolean;
}

export interface ModalActions {
  setShowSettings: React.Dispatch<React.SetStateAction<boolean>>;
  setSettingsInitialTab: React.Dispatch<React.SetStateAction<SettingsTab>>;
  setShowCommandPalette: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWelcomeScreen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowFirstLaunchModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTaskModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowNewProjectModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCloneModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowEditorMode: React.Dispatch<React.SetStateAction<boolean>>;
  setShowKanban: React.Dispatch<React.SetStateAction<boolean>>;
  setShowDeviceFlowModal: React.Dispatch<React.SetStateAction<boolean>>;
  openSettings: (tab?: SettingsTab) => void;
  handleToggleSettings: () => void;
  handleOpenSettings: () => void;
  handleOpenKeyboardShortcuts: () => void;
  handleCloseSettings: () => void;
  handleToggleCommandPalette: () => void;
  handleCloseCommandPalette: () => void;
  handleToggleKanban: () => void;
  handleToggleEditor: () => void;
  handleWelcomeGetStarted: () => void;
  markFirstLaunchSeen: () => void;
}

export function useModalState(deps: {
  selectedProjectRef: React.RefObject<{ id: string } | null>;
}): ModalState & ModalActions {
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('general');
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showWelcomeScreen, setShowWelcomeScreen] = useState<boolean>(false);
  const [showFirstLaunchModal, setShowFirstLaunchModal] = useState<boolean>(false);
  const [showTaskModal, setShowTaskModal] = useState<boolean>(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState<boolean>(false);
  const [showCloneModal, setShowCloneModal] = useState<boolean>(false);
  const [showEditorMode, setShowEditorMode] = useState(false);
  const [showKanban, setShowKanban] = useState<boolean>(false);
  const [showDeviceFlowModal, setShowDeviceFlowModal] = useState(false);

  const openSettings = useCallback((tab: SettingsTab = 'general') => {
    setSettingsInitialTab(tab);
    setShowSettings(true);
  }, []);

  const handleToggleSettings = useCallback(() => {
    setShowSettings((prev) => {
      if (!prev) {
        setSettingsInitialTab('general');
      }
      return !prev;
    });
  }, []);

  const handleOpenSettings = useCallback(() => {
    openSettings('general');
  }, [openSettings]);

  const handleOpenKeyboardShortcuts = useCallback(() => {
    openSettings('interface');
  }, [openSettings]);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  const handleToggleCommandPalette = useCallback(() => {
    setShowCommandPalette((prev) => !prev);
  }, []);

  const handleCloseCommandPalette = useCallback(() => {
    setShowCommandPalette(false);
  }, []);

  const handleToggleKanban = useCallback(() => {
    if (!deps.selectedProjectRef.current) return;
    setShowEditorMode(false);
    setShowKanban((v) => !v);
  }, [deps.selectedProjectRef]);

  const handleToggleEditor = useCallback(() => {
    setShowKanban(false);
    setShowEditorMode((v) => !v);
  }, []);

  const handleWelcomeGetStarted = useCallback(() => {
    setShowWelcomeScreen(false);
    setShowFirstLaunchModal(true);
  }, []);

  const markFirstLaunchSeen = useCallback(() => {
    try {
      localStorage.setItem(FIRST_LAUNCH_KEY, '1');
    } catch {
      // ignore
    }
    try {
      void window.electronAPI.setOnboardingSeen?.(true);
    } catch {
      // ignore
    }
    setShowFirstLaunchModal(false);
  }, []);

  // First-launch check effect
  useEffect(() => {
    const check = async () => {
      let seenLocal = false;
      try {
        seenLocal = localStorage.getItem(FIRST_LAUNCH_KEY) === '1';
      } catch {
        // ignore
      }
      if (seenLocal) return;

      try {
        const res = await window.electronAPI.getTelemetryStatus?.();
        if (res?.success && res.status?.onboardingSeen) return;
      } catch {
        // ignore
      }
      // Show WelcomeScreen for first-time users
      setShowWelcomeScreen(true);
    };
    void check();
  }, []);

  return {
    showSettings,
    settingsInitialTab,
    showCommandPalette,
    showWelcomeScreen,
    showFirstLaunchModal,
    showTaskModal,
    showNewProjectModal,
    showCloneModal,
    showEditorMode,
    showKanban,
    showDeviceFlowModal,
    setShowSettings,
    setSettingsInitialTab,
    setShowCommandPalette,
    setShowWelcomeScreen,
    setShowFirstLaunchModal,
    setShowTaskModal,
    setShowNewProjectModal,
    setShowCloneModal,
    setShowEditorMode,
    setShowKanban,
    setShowDeviceFlowModal,
    openSettings,
    handleToggleSettings,
    handleOpenSettings,
    handleOpenKeyboardShortcuts,
    handleCloseSettings,
    handleToggleCommandPalette,
    handleCloseCommandPalette,
    handleToggleKanban,
    handleToggleEditor,
    handleWelcomeGetStarted,
    markFirstLaunchSeen,
  };
}
