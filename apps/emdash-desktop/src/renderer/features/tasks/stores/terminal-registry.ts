import { observable } from 'mobx';
import { TerminalManagerStore } from '@renderer/features/tasks/terminals/terminal-manager';

export class TerminalRegistry {
  private readonly entries = observable.map<string, TerminalManagerStore>();

  acquire(projectId: string, taskId: string): TerminalManagerStore {
    const key = terminalRegistryKey(projectId, taskId);
    const existing = this.entries.get(key);
    if (existing) return existing;
    const store = new TerminalManagerStore(projectId, taskId);
    this.entries.set(key, store);
    return store;
  }

  get(projectId: string, taskId: string): TerminalManagerStore | undefined {
    return this.entries.get(terminalRegistryKey(projectId, taskId));
  }

  release(projectId: string, taskId: string): void {
    const key = terminalRegistryKey(projectId, taskId);
    const store = this.entries.get(key);
    if (!store) return;
    store.dispose();
    this.entries.delete(key);
  }
}

export function terminalRegistryKey(projectId: string, taskId: string) {
  return JSON.stringify([projectId, taskId]);
}

export const terminalRegistry = new TerminalRegistry();
