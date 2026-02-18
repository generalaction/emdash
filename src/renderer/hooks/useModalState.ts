import { useCallback, useEffect, useState } from 'react';
import { FIRST_LAUNCH_KEY } from '../constants/layout';

export type SettingsPageTab =
  | 'general'
  | 'clis-models'
  | 'integrations'
  | 'repository'
  | 'interface'
  | 'docs';

export interface ModalState {
  showSettingsPage: boolean;
  settingsPageInitialTab: SettingsPageTab;
  showCommandPalette: boolean;
  showWelcomeScreen: boolean;
  showTaskModal: boolean;
  showNewProjectModal: boolean;
  showCloneModal: boolean;
  showEditorMode: boolean;
  showKanban: boolean;
  showDeviceFlowModal: boolean;
}

export interface ModalActions {
  setShowSettingsPage: React.Dispatch<React.SetStateAction<boolean>>;
  setSettingsPageInitialTab: React.Dispatch<React.SetStateAction<SettingsPageTab>>;
  setShowCommandPalette: React.Dispatch<React.SetStateAction<boolean>>;
  setShowWelcomeScreen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTaskModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowNewProjectModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCloneModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowEditorMode: React.Dispatch<React.SetStateAction<boolean>>;
  setShowKanban: React.Dispatch<React.SetStateAction<boolean>>;
  setShowDeviceFlowModal: React.Dispatch<React.SetStateAction<boolean>>;
  openSettingsPage: (tab?: SettingsPageTab) => void;
  handleOpenKeyboardShortcuts: () => void;
  handleCloseSettingsPage: () => void;
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
  const [showSettingsPage, setShowSettingsPage] = useState<boolean>(false);
  const [settingsPageInitialTab, setSettingsPageInitialTab] = useState<SettingsPageTab>('general');
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showWelcomeScreen, setShowWelcomeScreen] = useState<boolean>(false);
  const [showTaskModal, setShowTaskModal] = useState<boolean>(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState<boolean>(false);
  const [showCloneModal, setShowCloneModal] = useState<boolean>(false);
  const [showEditorMode, setShowEditorMode] = useState(false);
  const [showKanban, setShowKanban] = useState<boolean>(false);
  const [showDeviceFlowModal, setShowDeviceFlowModal] = useState(false);

  const openSettingsPage = useCallback((tab: SettingsPageTab = 'general') => {
    setSettingsPageInitialTab(tab);
    setShowSettingsPage(true);
  }, []);

  const handleOpenKeyboardShortcuts = useCallback(() => {
    openSettingsPage('interface');
  }, [openSettingsPage]);

  const handleCloseSettingsPage = useCallback(() => {
    setShowSettingsPage(false);
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
  }, []);

  const handleWelcomeGetStarted = useCallback(() => {
    setShowWelcomeScreen(false);
    markFirstLaunchSeen();
  }, [markFirstLaunchSeen]);

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
    showSettingsPage,
    settingsPageInitialTab,
    showCommandPalette,
    showWelcomeScreen,
    showTaskModal,
    showNewProjectModal,
    showCloneModal,
    showEditorMode,
    showKanban,
    showDeviceFlowModal,
    setShowSettingsPage,
    setSettingsPageInitialTab,
    setShowCommandPalette,
    setShowWelcomeScreen,
    setShowTaskModal,
    setShowNewProjectModal,
    setShowCloneModal,
    setShowEditorMode,
    setShowKanban,
    setShowDeviceFlowModal,
    openSettingsPage,
    handleOpenKeyboardShortcuts,
    handleCloseSettingsPage,
    handleToggleCommandPalette,
    handleCloseCommandPalette,
    handleToggleKanban,
    handleToggleEditor,
    handleWelcomeGetStarted,
    markFirstLaunchSeen,
  };
}
