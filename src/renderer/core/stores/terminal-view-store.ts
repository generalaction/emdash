import { makeAutoObservable } from 'mobx';
import { TabsStore } from '@renderer/core/stores/tabs-store';

export class TerminalsViewState {
  readonly tabs = new TabsStore();

  constructor() {
    makeAutoObservable(this);
  }

  get activeTerminalId(): string | undefined {
    return this.tabs.activeTabId;
  }

  setActiveTerminalId(id: string): void {
    this.tabs.setActiveTab(id);
  }
}
