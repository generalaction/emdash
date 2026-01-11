import { useCallback, useState } from 'react';

export interface AppModalsState {
  showEditorMode: boolean;
  setShowEditorMode: (show: boolean) => void;
  showTaskModal: boolean;
  setShowTaskModal: (show: boolean) => void;
  showNewProjectModal: boolean;
  setShowNewProjectModal: (show: boolean) => void;
  showCloneModal: boolean;
  setShowCloneModal: (show: boolean) => void;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  showCommandPalette: boolean;
  setShowCommandPalette: (show: boolean) => void;
  showFirstLaunchModal: boolean;
  setShowFirstLaunchModal: (show: boolean) => void;
  showDeviceFlowModal: boolean;
  setShowDeviceFlowModal: (show: boolean) => void;
  showKanban: boolean;
  setShowKanban: (show: boolean) => void;
}

export interface AppModalsHandlers {
  handleToggleSettings: () => void;
  handleOpenSettings: () => void;
  handleCloseSettings: () => void;
  handleToggleCommandPalette: () => void;
  handleCloseCommandPalette: () => void;
  handleToggleKanban: () => void;
}

export function useAppModals(): AppModalsState & AppModalsHandlers {
  const [showEditorMode, setShowEditorMode] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showFirstLaunchModal, setShowFirstLaunchModal] = useState(false);
  const [showDeviceFlowModal, setShowDeviceFlowModal] = useState(false);
  const [showKanban, setShowKanban] = useState(false);

  const handleToggleSettings = useCallback(() => {
    setShowSettings((prev) => !prev);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

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
    setShowKanban((prev) => !prev);
  }, []);

  return {
    showEditorMode,
    setShowEditorMode,
    showTaskModal,
    setShowTaskModal,
    showNewProjectModal,
    setShowNewProjectModal,
    showCloneModal,
    setShowCloneModal,
    showSettings,
    setShowSettings,
    showCommandPalette,
    setShowCommandPalette,
    showFirstLaunchModal,
    setShowFirstLaunchModal,
    showDeviceFlowModal,
    setShowDeviceFlowModal,
    showKanban,
    setShowKanban,
    handleToggleSettings,
    handleOpenSettings,
    handleCloseSettings,
    handleToggleCommandPalette,
    handleCloseCommandPalette,
    handleToggleKanban,
  };
}
