import { useCallback, useEffect, useRef } from 'react';
import { useAgentEvents } from '../hooks/useAgentEvents';
import useUpdateNotifier from '../hooks/useUpdateNotifier';
import { useModalContext } from '../contexts/ModalProvider';
import { useWorkspaceNavigation } from '../contexts/WorkspaceNavigationContext';
import { useTaskManagementContext } from '../contexts/TaskManagementProvider';
import { useAppSettings } from '../contexts/AppSettingsProvider';
import { activityStore } from '../lib/activityStore';
import { handleMenuUndo, handleMenuRedo } from '../lib/menuUndoRedo';
import { soundPlayer } from '../lib/soundPlayer';
import type { AgentEvent } from '@shared/agentEvents';
import AppKeyboardShortcuts from './AppKeyboardShortcuts';

/**
 * WorkspaceEffects mounts all persistent global side effects:
 * - Agent event listener (sounds + activity store)
 * - Update notifier
 * - IPC listeners: menu actions, notification focus, Undo/Redo, etc.
 * Renders nothing.
 */
export function WorkspaceEffects() {
  const { showModal } = useModalContext();
  const { navigate } = useWorkspaceNavigation();
  const { allTasks } = useTaskManagementContext();
  const { settings } = useAppSettings();

  // Sync sound player enabled state from settings
  useEffect(() => {
    const notif = settings?.notifications;
    const masterEnabled = Boolean(notif?.enabled ?? true);
    const soundOn = Boolean(notif?.sound ?? true);
    soundPlayer.setEnabled(masterEnabled && soundOn);
  }, [settings?.notifications]);

  // Agent event handling: sounds + activity store
  const handleAgentEvent = useCallback((event: AgentEvent) => {
    activityStore.handleAgentEvent(event);
  }, []);
  useAgentEvents(handleAgentEvent);

  // Show toast on update availability
  useUpdateNotifier({
    checkOnMount: true,
    onOpenSettings: () => navigate('settings'),
  });

  // Focus task when OS notification is clicked
  const allTasksRef = useRef(allTasks);
  useEffect(() => {
    allTasksRef.current = allTasks;
  });

  useEffect(() => {
    return window.electronAPI.onNotificationFocusTask((taskId: string) => {
      const entry = allTasksRef.current.find((t) => t.task.id === taskId);
      if (!entry) return;
      navigate('task', { projectId: entry.task.projectId, taskId: entry.task.id });
    });
  }, [navigate]);

  // Native menu: "Settings"
  useEffect(() => {
    return window.electronAPI.onMenuOpenSettings?.(() => {
      navigate('settings');
    });
  }, [navigate]);

  // Native menu: "Check for Updates"
  useEffect(() => {
    return window.electronAPI.onMenuCheckForUpdates?.(() => {
      showModal('updateModal', {});
    });
  }, [showModal]);

  // Native menu: Undo/Redo — tries active Monaco editor first, falls back to native undo API
  useEffect(() => {
    const cleanupUndo = window.electronAPI.onMenuUndo?.(() => handleMenuUndo());
    const cleanupRedo = window.electronAPI.onMenuRedo?.(() => handleMenuRedo());
    return () => {
      cleanupUndo?.();
      cleanupRedo?.();
    };
  }, []);

  return <AppKeyboardShortcuts />;
}
