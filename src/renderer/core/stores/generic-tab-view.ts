import { action, computed, makeObservable, observable, runInAction } from 'mobx';

interface GenericTabViewStoreProps<TEntity, TArgs> {
  // should be an observable map
  entities: Map<string, TEntity>;
  onBeforeRemove: (tab: TEntity) => Promise<void>;
  onAdd: (args: TArgs) => Promise<TEntity>;
}

interface GenericTabViewProvider<TEntity, TArgs> {
  removeTab: (tabId: string) => void;
  addTab: (args: TArgs) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  setNextTabActive: () => void;
  setPreviousTabActive: () => void;
  setTabActiveIndex: (index: number) => void;
  activeTab: TEntity | undefined;
  tabs: TEntity[];
}

interface Snapshottable<T> {
  readonly snapshot: T;
  restoreSnapshot: (snapshot: Partial<T>) => void;
}

type TabViewSnapshot = {
  tabOrder: string[];
  activeTabId: string | undefined;
};

export class GenericTabViewStore<TEntity extends { id: string }, TArgs>
  implements GenericTabViewProvider<TEntity, TArgs>, Snapshottable<TabViewSnapshot>
{
  entities: Map<string, TEntity>;
  tabOrder: string[] = [];
  activeTabId: string | undefined = undefined;
  onBeforeRemove: (tab: TEntity) => Promise<void>;
  onAdd: (args: TArgs) => Promise<TEntity>;

  constructor(props: GenericTabViewStoreProps<TEntity, TArgs>) {
    this.entities = props.entities;
    this.onBeforeRemove = props.onBeforeRemove;
    this.onAdd = props.onAdd;

    makeObservable(this, {
      tabOrder: observable,
      activeTabId: observable,
      activeTab: computed,
      tabs: computed,
      addTab: action,
      removeTab: action,
      reorderTabs: action,
      setNextTabActive: action,
      setPreviousTabActive: action,
      setTabActiveIndex: action,
    });

    for (const entity of Object.values(this.entities)) {
      this.tabOrder.push(entity.id);
    }
  }

  get activeTab(): TEntity | undefined {
    return this.activeTabId ? this.entities.get(this.activeTabId) : undefined;
  }

  get tabs(): TEntity[] {
    return Array.from(this.entities.values());
  }

  removeTab(tabId: string): void {
    const tab = this.entities.get(tabId);
    if (!tab) return;
    this.onBeforeRemove(tab)
      .then(() => {
        runInAction(() => {
          const index = this.tabOrder.indexOf(tab.id);
          if (index === -1) return;
          this.tabOrder.splice(index, 1);
          if (this.activeTabId === tab.id) {
            this.activeTabId = this.tabOrder[index] ?? this.tabOrder[index - 1];
          }
        });
      })
      .catch(() => {});
  }

  addTab(args: TArgs): void {
    this.onAdd(args).then((tab) => {
      this.tabOrder.push(tab.id);
      if (!this.activeTabId) {
        this.activeTabId = tab.id;
      }
    });
  }

  reorderTabs(fromIndex: number, toIndex: number): void {
    const [tab] = this.tabOrder.splice(fromIndex, 1);
    this.tabOrder.splice(toIndex, 0, tab);
  }

  setNextTabActive(): void {
    if (!this.activeTabId) return;
    const nextTabId = this.tabOrder[this.tabOrder.indexOf(this.activeTabId) + 1];
    if (nextTabId) {
      this.activeTabId = nextTabId;
    }
  }

  setPreviousTabActive(): void {
    if (!this.activeTabId) return;
    const previousTabId = this.tabOrder[this.tabOrder.indexOf(this.activeTabId) - 1];
    if (previousTabId) {
      this.activeTabId = previousTabId;
    }
  }

  setTabActiveIndex(index: number): void {
    if (index < 0) return;
    if (index > 9 && this.tabOrder.length > 9) {
      this.activeTabId = this.tabOrder[this.tabOrder.length - 1];
    } else if (index >= this.tabOrder.length) {
      this.activeTabId = this.tabOrder[this.tabOrder.length - 1];
    } else {
      this.activeTabId = this.tabOrder[index];
    }
  }

  get snapshot(): TabViewSnapshot {
    return { tabOrder: this.tabOrder, activeTabId: this.activeTabId };
  }

  restoreSnapshot(snapshot: Partial<TabViewSnapshot>) {
    if (snapshot.tabOrder) {
      this.tabOrder = snapshot.tabOrder;
    }
    if (snapshot.activeTabId) {
      this.activeTabId = snapshot.activeTabId;
    }
  }
}
