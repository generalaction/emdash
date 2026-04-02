import { action, computed, makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import { Conversation, CreateConversationParams } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import { rpc } from '@renderer/core/ipc';
import { TabViewProvider, TabViewSnapshot } from '@renderer/core/stores/generic-tab-view';
import { Snapshottable } from '@renderer/core/stores/snapshottable';
import {
  addTabId,
  removeTabId,
  reorderTabIds,
  setNextTabActive,
  setPreviousTabActive,
  setTabActive,
  setTabActiveIndex,
} from '@renderer/core/stores/tab-utils';
import { PtySession } from './pty-session';

export class ConversationManagerStore
  implements
    TabViewProvider<ConversationStore, CreateConversationParams>,
    Snapshottable<TabViewSnapshot>
{
  private _loaded = false;
  conversations = observable.map<string, ConversationStore>();
  tabOrder: string[] = [];
  activeTabId: string | undefined = undefined;

  constructor(
    private readonly projectId: string,
    private readonly taskId: string
  ) {
    makeObservable(this, {
      conversations: observable,
      tabOrder: observable,
      activeTabId: observable,
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
    });
    onBecomeObserved(this, 'tabOrder', () => {
      if (this._loaded) return;
      this.load();
    });
  }

  get tabs(): ConversationStore[] {
    return this.tabOrder
      .map((id) => this.conversations.get(id))
      .filter(Boolean) as ConversationStore[];
  }

  get activeTab(): ConversationStore | undefined {
    return this.activeTabId ? this.conversations.get(this.activeTabId) : undefined;
  }

  get snapshot(): TabViewSnapshot {
    return { tabOrder: this.tabOrder.slice(), activeTabId: this.activeTabId };
  }

  restoreSnapshot(snapshot: Partial<TabViewSnapshot>): void {
    if (snapshot.tabOrder) this.tabOrder = snapshot.tabOrder;
    if (snapshot.activeTabId !== undefined) this.activeTabId = snapshot.activeTabId;
  }

  setActiveTab(id: string): void {
    setTabActive(this, id);
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

  addTab(params: CreateConversationParams): void {
    void this.createConversation(params);
  }

  removeTab(conversationId: string): void {
    void this.deleteConversation(conversationId);
  }

  closeActiveTab(): void {
    if (this.activeTabId) this.removeTab(this.activeTabId);
  }

  async load() {
    this._loaded = true;
    const conversations = await rpc.conversations.getConversationsForTask(
      this.projectId,
      this.taskId
    );
    runInAction(() => {
      for (const conversation of conversations) {
        const store = new ConversationStore(conversation);
        this.conversations.set(conversation.id, store);
        addTabId(this, conversation.id);
        void store.session.connect();
      }
      if (!this.activeTabId && this.tabOrder.length > 0) {
        this.activeTabId = this.tabOrder[0];
      }
    });
  }

  async createConversation(params: CreateConversationParams): Promise<Conversation> {
    const conversation = await rpc.conversations.createConversation(params);
    runInAction(() => {
      const store = new ConversationStore(conversation);
      this.conversations.set(params.id, store);
      addTabId(this, params.id);
      setTabActive(this, params.id);
      void store.session.connect();
    });
    return conversation;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const snapshot = this.conversations.get(conversationId);
    if (!snapshot) return;

    const tabSnapshot = this.snapshot;

    runInAction(() => {
      this.conversations.delete(conversationId);
      removeTabId(this, conversationId);
    });

    try {
      await rpc.conversations.deleteConversation(this.projectId, this.taskId, conversationId);
      snapshot.dispose();
    } catch (err) {
      runInAction(() => {
        this.conversations.set(conversationId, snapshot);
        this.restoreSnapshot(tabSnapshot);
      });
      throw err;
    }
  }

  async renameConversation(conversationId: string, name: string): Promise<void> {
    const store = this.conversations.get(conversationId);
    if (!store) return;

    const previousTitle = store.data.title;

    runInAction(() => {
      store.data.title = name;
    });

    try {
      await rpc.conversations.renameConversation(conversationId, name);
    } catch (err) {
      runInAction(() => {
        store.data.title = previousTitle;
      });
      throw err;
    }
  }
}

export class ConversationStore {
  data: Conversation;
  session: PtySession;

  constructor(conversation: Conversation) {
    this.data = conversation;
    this.session = new PtySession(
      makePtySessionId(conversation.projectId, conversation.taskId, conversation.id)
    );
    makeObservable(this, { data: observable, session: observable });
  }

  dispose() {
    this.session.dispose();
  }
}
