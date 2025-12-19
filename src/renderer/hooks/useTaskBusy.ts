import { useEffect, useState } from 'react';
import { activityStore } from '../lib/activityStore';

export function useTaskBusy(taskId: string) {
  const [busy, setBusy] = useState(false);
  useEffect(() => activityStore.subscribe(taskId, setBusy), [taskId]);
  return busy;
}
