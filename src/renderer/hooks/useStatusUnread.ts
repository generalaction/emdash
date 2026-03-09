import { useEffect, useState } from 'react';
import { agentStatusStore } from '../lib/agentStatusStore';

export function useStatusUnread(id: string): boolean {
  const [unread, setUnread] = useState(false);

  useEffect(() => agentStatusStore.subscribeUnread(id, setUnread), [id]);

  return unread;
}
