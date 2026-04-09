import { action, autorun, computed, makeObservable, observable, reaction } from 'mobx';
import type { TabViewProvider, TabViewSnapshot } from '@renderer/lib/stores/generic-tab-view';
import { Snapshottable } from '@renderer/lib/stores/snapshottable';
import {
  reorderTabIds,
  setNextTabActive,
  setPreviousTabActive,
  setTabActive,
  setTabActiveIndex,
} from '@renderer/lib/stores/tab-utils';
import { focusTracker } from '@renderer/utils/focus-tracker';
import type { ConversationManagerStore, ConversationStore } from './conversation-manager';

export class ConversationTabViewStore
  implements TabViewProvider<ConversationStore, never>, Snapshottable<TabViewSnapshot>
{
  tabOrder: string[] = [];
  activeTabId: string | undefined = undefined;
  isVisible = false;

  private readonly resource: ConversationManagerStore;
  private readonly disposers: (() => void)[] = [];

  constructor(resource: ConversationManagerStore) {
    this.resource = resource;
    makeObservable(this, {
      tabOrder: observable,
      activeTabId: observable,
      isVisible: observable,
      tabs: computed,
      activeTab: computed,
      snapshot: computed,
      addTab: action,
      removeTab: action,
      reorderTabs: action,
      setNextTabActive: action,
      setPreviousTabActive: action,
      setTabActiveIndex: action,
      setActiveTab: action,
      setVisible: action,
      restoreSnapshot: action,
    });

    this.disposers.push(
      reaction(
        () => Array.from(this.resource.conversations.keys()),
        action((ids: string[]) => {
          const idSet = new Set(ids);
          // Remove deleted IDs
          for (let i = this.tabOrder.length - 1; i >= 0; i--) {
            if (!idSet.has(this.tabOrder[i])) {
              this.tabOrder.splice(i, 1);
            }
          }
          // Append new IDs
          for (const id of ids) {
            if (!this.tabOrder.includes(id)) {
              this.tabOrder.push(id);
            }
          }
          // Deselect removed active tab
          if (this.activeTabId && !idSet.has(this.activeTabId)) {
            this.activeTabId = this.tabOrder[0];
          }
          // Auto-select first if nothing is active
          if (!this.activeTabId && this.tabOrder.length > 0) {
            this.activeTabId = this.tabOrder[0];
          }
        })
      )
    );

    this.disposers.push(
      autorun(() => {
        if (this.isVisible && this.activeTab && !this.activeTab.seen) {
          this.activeTab.markSeen();
        }
      })
    );
  }

  get tabs(): ConversationStore[] {
    return this.tabOrder
      .map((id) => this.resource.conversations.get(id))
      .filter(Boolean) as ConversationStore[];
  }

  get activeTab(): ConversationStore | undefined {
    return this.activeTabId ? this.resource.conversations.get(this.activeTabId) : undefined;
  }

  get snapshot(): TabViewSnapshot {
    return { tabOrder: this.tabOrder.slice(), activeTabId: this.activeTabId };
  }

  restoreSnapshot(snapshot: Partial<TabViewSnapshot>): void {
    if (snapshot.tabOrder) this.tabOrder = snapshot.tabOrder;
    if (snapshot.activeTabId !== undefined) this.activeTabId = snapshot.activeTabId;
  }

  setActiveTab(id: string): void {
    const previousTabId = this.activeTabId;
    setTabActive(this, id);
    if (previousTabId !== this.activeTabId) {
      const index = this.activeTabId ? this.tabOrder.indexOf(this.activeTabId) : -1;
      focusTracker.transition({ conversationIndex: index >= 0 ? index : null }, 'tab_switch');
    }
  }

  reorderTabs(fromIndex: number, toIndex: number): void {
    reorderTabIds(this, fromIndex, toIndex);
  }

  setNextTabActive(): void {
    setNextTabActive(this);
  }

  setPreviousTabActive(): void {
    setPreviousTabActive(this);
  }

  setTabActiveIndex(index: number): void {
    setTabActiveIndex(this, index);
  }

  // addTab is required by TabViewProvider but conversations are created via modal
  addTab(_args: never): void {}

  removeTab(id: string): void {
    void this.resource.deleteConversation(id);
  }

  closeActiveTab(): void {
    if (this.activeTabId) this.removeTab(this.activeTabId);
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}
