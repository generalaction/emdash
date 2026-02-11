import { useEffect, useState } from 'react';
import { terminalLivenessStore } from '../lib/terminalLivenessStore';

export function useTaskHasTerminal(taskId: string): boolean {
  const [hasTerminal, setHasTerminal] = useState(false);
  useEffect(() => terminalLivenessStore.subscribe(taskId, setHasTerminal), [taskId]);
  return hasTerminal;
}
