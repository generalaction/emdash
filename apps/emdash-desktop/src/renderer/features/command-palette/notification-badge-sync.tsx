import { reaction } from 'mobx';
import { useEffect } from 'react';
import { rpc } from '@renderer/lib/ipc';
import { appState } from '@renderer/lib/stores/app-state';
import { getPaletteNotificationItems } from './palette-notifications';

function getCurrentNotificationContext(): {
  currentProjectId: string | undefined;
  currentTaskId: string | undefined;
} {
  const { currentViewId, viewParamsStore } = appState.navigation;

  if (currentViewId === 'task') {
    const params = viewParamsStore.task;
    return {
      currentProjectId: params?.projectId,
      currentTaskId: params?.taskId,
    };
  }

  if (currentViewId === 'project') {
    return {
      currentProjectId: viewParamsStore.project?.projectId,
      currentTaskId: undefined,
    };
  }

  return { currentProjectId: undefined, currentTaskId: undefined };
}

function getCurrentPaletteNotificationCount(): number {
  const { currentProjectId, currentTaskId } = getCurrentNotificationContext();
  return getPaletteNotificationItems(currentProjectId, currentTaskId).length;
}

export function NotificationBadgeSync() {
  useEffect(
    () =>
      reaction(
        () => getCurrentPaletteNotificationCount(),
        (count) => {
          void rpc.app.setNotificationBadgeCount(count);
        },
        { fireImmediately: true }
      ),
    []
  );

  return null;
}
