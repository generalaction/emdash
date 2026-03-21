import { useEffect, useState } from 'react';
import type { NotificationType } from '@shared/agentStatus';
import { agentStatusStore } from '../lib/agentStatusStore';

export function useTaskNotificationType(taskId: string): NotificationType | undefined {
  const [notificationType, setNotificationType] = useState<NotificationType | undefined>();

  useEffect(() => {
    const unsubscribe = agentStatusStore.subscribe(taskId, (snapshot) => {
      setNotificationType(snapshot.notificationType);
    });
    return unsubscribe;
  }, [taskId]);

  return notificationType;
}
