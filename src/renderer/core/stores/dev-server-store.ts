import { action, computed, makeObservable, observable } from 'mobx';
import { hostPreviewEventChannel } from '@shared/events/hostPreviewEvents';
import { events } from '@renderer/core/ipc';

export class DevServerStore {
  private readonly taskId: string;
  private readonly _unsubscribe: () => void;

  servers = observable.map<string, string>();

  constructor(taskId: string) {
    this.taskId = taskId;
    makeObservable(this, {
      servers: observable,
      urls: computed,
      addServer: action,
      removeServer: action,
      clear: action,
    });

    this._unsubscribe = events.on(hostPreviewEventChannel, (event) => {
      if (event.taskId !== this.taskId) return;
      if (event.type === 'url' && event.terminalId && event.url) {
        this.addServer(event.terminalId, event.url);
      } else if (event.type === 'exit' && event.terminalId) {
        this.removeServer(event.terminalId);
      }
    });
  }

  get urls(): string[] {
    return Array.from(this.servers.values());
  }

  addServer(terminalId: string, url: string): void {
    this.servers.set(terminalId, url);
  }

  removeServer(terminalId: string): void {
    this.servers.delete(terminalId);
  }

  clear(): void {
    this.servers.clear();
  }

  dispose(): void {
    this._unsubscribe();
  }
}
