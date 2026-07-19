import { terminalRegistry } from './stores/terminal-registry';

export function getTerminalsForTask(taskId: string) {
  return terminalRegistry.get(taskId);
}
