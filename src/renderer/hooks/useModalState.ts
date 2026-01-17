import { useCallback, useState } from 'react';

/**
 * Hook to manage all modal states in the application
 * Centralizes modal visibility management with consistent API
 */

export interface ModalState {
  showTaskModal: boolean;
  showNewProjectModal: boolean;
  showCloneModal: boolean;
  showSettings: boolean;
  showCommandPalette: boolean;
  showWelcomeScreen: boolean;
  showFirstLaunchModal: boolean;
  showDeviceFlowModal: boolean;
  showEditorMode: boolean;
  showKanban: boolean;
}

export interface ModalActions {
  // Task modal
  openTaskModal: () => void;
  closeTaskModal: () => void;

  // New project modal
  openNewProjectModal: () => void;
  closeNewProjectModal: () => void;

  // Clone modal
  openCloneModal: () => void;
  closeCloneModal: () => void;

  // Settings
  openSettings: () => void;
  closeSettings: () => void;
  toggleSettings: () => void;

  // Command palette
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;

  // Welcome/onboarding
  openWelcomeScreen: () => void;
  closeWelcomeScreen: () => void;
  openFirstLaunchModal: () => void;
  closeFirstLaunchModal: () => void;

  // GitHub device flow
  openDeviceFlowModal: () => void;
  closeDeviceFlowModal: () => void;

  // Editor mode
  toggleEditorMode: () => void;
  setEditorMode: (show: boolean) => void;

  // Kanban view
  toggleKanban: () => void;
  setKanbanOpen: (show: boolean) => void;
}

export function useModalState(): ModalState & ModalActions {
  const [showTaskModal, setShowTaskModal] = useState<boolean>(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState<boolean>(false);
  const [showCloneModal, setShowCloneModal] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showWelcomeScreen, setShowWelcomeScreen] = useState<boolean>(false);
  const [showFirstLaunchModal, setShowFirstLaunchModal] = useState<boolean>(false);
  const [showDeviceFlowModal, setShowDeviceFlowModal] = useState<boolean>(false);
  const [showEditorMode, setShowEditorMode] = useState<boolean>(false);
  const [showKanban, setShowKanban] = useState<boolean>(false);

  // Task modal actions
  const openTaskModal = useCallback(() => setShowTaskModal(true), []);
  const closeTaskModal = useCallback(() => setShowTaskModal(false), []);

  // New project modal actions
  const openNewProjectModal = useCallback(() => setShowNewProjectModal(true), []);
  const closeNewProjectModal = useCallback(() => setShowNewProjectModal(false), []);

  // Clone modal actions
  const openCloneModal = useCallback(() => setShowCloneModal(true), []);
  const closeCloneModal = useCallback(() => setShowCloneModal(false), []);

  // Settings actions
  const openSettings = useCallback(() => setShowSettings(true), []);
  const closeSettings = useCallback(() => setShowSettings(false), []);
  const toggleSettings = useCallback(() => setShowSettings(prev => !prev), []);

  // Command palette actions
  const openCommandPalette = useCallback(() => setShowCommandPalette(true), []);
  const closeCommandPalette = useCallback(() => setShowCommandPalette(false), []);
  const toggleCommandPalette = useCallback(() => setShowCommandPalette(prev => !prev), []);

  // Welcome/onboarding actions
  const openWelcomeScreen = useCallback(() => setShowWelcomeScreen(true), []);
  const closeWelcomeScreen = useCallback(() => setShowWelcomeScreen(false), []);
  const openFirstLaunchModal = useCallback(() => setShowFirstLaunchModal(true), []);
  const closeFirstLaunchModal = useCallback(() => setShowFirstLaunchModal(false), []);

  // GitHub device flow actions
  const openDeviceFlowModal = useCallback(() => setShowDeviceFlowModal(true), []);
  const closeDeviceFlowModal = useCallback(() => setShowDeviceFlowModal(false), []);

  // Editor mode actions
  const toggleEditorMode = useCallback(() => setShowEditorMode(prev => !prev), []);
  const setEditorMode = useCallback((show: boolean) => setShowEditorMode(show), []);

  // Kanban view actions
  const toggleKanban = useCallback(() => setShowKanban(prev => !prev), []);
  const setKanbanOpen = useCallback((show: boolean) => setShowKanban(show), []);

  return {
    // State
    showTaskModal,
    showNewProjectModal,
    showCloneModal,
    showSettings,
    showCommandPalette,
    showWelcomeScreen,
    showFirstLaunchModal,
    showDeviceFlowModal,
    showEditorMode,
    showKanban,

    // Actions
    openTaskModal,
    closeTaskModal,
    openNewProjectModal,
    closeNewProjectModal,
    openCloneModal,
    closeCloneModal,
    openSettings,
    closeSettings,
    toggleSettings,
    openCommandPalette,
    closeCommandPalette,
    toggleCommandPalette,
    openWelcomeScreen,
    closeWelcomeScreen,
    openFirstLaunchModal,
    closeFirstLaunchModal,
    openDeviceFlowModal,
    closeDeviceFlowModal,
    toggleEditorMode,
    setEditorMode,
    toggleKanban,
    setKanbanOpen,
  };
}