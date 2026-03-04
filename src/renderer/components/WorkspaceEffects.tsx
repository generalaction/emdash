import { useEffect, useRef } from 'react';
import useUpdateNotifier from '../hooks/useUpdateNotifier';
import { useModalContext } from '../contexts/ModalProvider';
import { useWorkspaceNavigation } from '../contexts/WorkspaceNavigationContext';
import { useWorkspaceSlots, useWorkspaceWrapParams } from '../contexts/WorkspaceViewProvider';
import { useTaskManagementContext } from '../contexts/TaskManagementProvider';
import { useAppSettings } from '../contexts/AppSettingsProvider';
import { useAgent } from '../contexts/AgentProvider';
import { handleMenuUndo, handleMenuRedo } from '../lib/menuUndoRedo';
import { soundPlayer } from '../lib/soundPlayer';
import { events } from '../lib/rpc';
import { notificationFocusTaskChannel } from '@shared/events/appEvents';
import AppKeyboardShortcuts from './AppKeyboardShortcuts';

/**
 * WorkspaceEffects mounts all persistent global side effects:
 * - Sound player settings sync
 * - Update notifier
 * - IPC listeners: notification focus, menu actions, Undo/Redo, etc.
 * Renders nothing. Agent event subscription is handled by AgentProvider.
 */
export function WorkspaceEffects() {
  const { showModal } = useModalContext();
  const { navigate } = useWorkspaceNavigation();
  const { allTasks } = useTaskManagementContext();
  const { settings } = useAppSettings();
  const { dismissNotifications } = useAgent();
  const { currentView } = useWorkspaceSlots();
  const { wrapParams } = useWorkspaceWrapParams();

  // Sync sound player enabled state from settings
  useEffect(() => {
    const notif = settings?.notifications;
    const masterEnabled = Boolean(notif?.enabled ?? true);
    const soundOn = Boolean(notif?.sound ?? true);
    soundPlayer.setEnabled(masterEnabled && soundOn);
  }, [settings?.notifications]);

  // Dismiss notifications when the user navigates to a task
  useEffect(() => {
    if (currentView === 'task' && typeof wrapParams.taskId === 'string') {
      dismissNotifications(wrapParams.taskId);
    }
  }, [currentView, wrapParams.taskId, dismissNotifications]);

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
    return events.on(notificationFocusTaskChannel, ({ taskId }) => {
      const entry = allTasksRef.current.find((t) => t.task.id === taskId);
      if (!entry) return;
      dismissNotifications(taskId);
      navigate('task', { projectId: entry.task.projectId, taskId: entry.task.id });
    });
  }, [navigate, dismissNotifications]);

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
