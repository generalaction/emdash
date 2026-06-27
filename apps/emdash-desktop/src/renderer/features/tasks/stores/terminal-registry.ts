import { observable } from 'mobx';
import { TerminalManagerStore } from '@renderer/features/tasks/terminals/terminal-manager';

export class TerminalRegistry {
  private readonly entries = observable.map<string, TerminalManagerStore>();

  acquire(taskId: string, projectId: string, sshConnectionId?: string): TerminalManagerStore {
    const existing = this.entries.get(taskId);
    if (existing) {
      if (arguments.length >= 3) existing.setSshConnectionId(sshConnectionId);
      return existing;
    }
    const store = new TerminalManagerStore(projectId, taskId, sshConnectionId);
    this.entries.set(taskId, store);
    return store;
  }

  get(taskId: string): TerminalManagerStore | undefined {
    return this.entries.get(taskId);
  }

  release(taskId: string): void {
    const store = this.entries.get(taskId);
    if (!store) return;
    store.dispose();
    this.entries.delete(taskId);
  }
}

export const terminalRegistry = new TerminalRegistry();
