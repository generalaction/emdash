import { makeAutoObservable } from 'mobx';

export type TabsStoreSnapshot = {
  tabOrder: string[];
  activeTabId: string | undefined;
};

export class TabsStore {
  tabOrder: string[] = [];
  activeTabId: string | undefined = undefined;

  constructor() {
    makeAutoObservable(this);
  }

  getActiveIndex(): number {
    return this.activeTabId ? this.tabOrder.indexOf(this.activeTabId) : -1;
  }

  setActiveTab(tabId: string): void {
    this.activeTabId = tabId;
  }

  addTab(id: string): void {
    if (!this.tabOrder.includes(id)) {
      this.tabOrder.push(id);
    }
  }

  removeTab(id: string): void {
    const idx = this.tabOrder.indexOf(id);
    if (idx === -1) return;
    this.tabOrder.splice(idx, 1);
    if (this.activeTabId === id) {
      // prefer the tab that slid into this slot, then the one before it
      this.activeTabId = this.tabOrder[idx] ?? this.tabOrder[idx - 1];
    }
  }

  reorderTabs(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    const [tab] = this.tabOrder.splice(fromIndex, 1);
    this.tabOrder.splice(toIndex, 0, tab);
  }
}
