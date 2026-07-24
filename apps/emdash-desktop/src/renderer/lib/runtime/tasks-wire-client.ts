import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from './desktop-wire-client';

export type TasksWireClient = DesktopWireClient['tasks'];

export async function getTasksWireClient(): Promise<TasksWireClient> {
  return (await getDesktopWireClient()).tasks;
}

export function resetTasksWireClient(): void {
  resetDesktopWireClient();
}
