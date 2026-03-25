import {
  makeAutoObservable,
  makeObservable,
  observable,
  onBecomeObserved,
  runInAction,
} from 'mobx';
import { Conversation, CreateConversationParams } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import { rpc } from '@renderer/core/ipc';
import { TabsStore } from '@renderer/core/stores/tabs-store';
import { PtySession } from './pty-session';

export class ConversationsViewState {
  readonly tabs = new TabsStore();

  constructor() {
    makeAutoObservable(this);
  }

  get activeConversationId(): string | undefined {
    return this.tabs.activeTabId;
  }

  setActiveConversationId(id: string): void {
    this.tabs.setActiveTab(id);
  }
}

export class ConversationManagerStore {
  readonly view = new ConversationsViewState();
  private _loaded = false;
  conversations = observable.map<string, ConversationStore>();
  tabs = new TabsStore();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string
  ) {
    makeObservable(this, { conversations: observable });
    onBecomeObserved(this, 'conversations', () => {
      if (this._loaded) return;
      this.load();
    });
  }

  async load() {
    const conversations = await rpc.conversations.getConversationsForTask(
      this.projectId,
      this.taskId
    );
    runInAction(() => {
      for (const conversation of conversations) {
        const store = new ConversationStore(conversation);
        this.conversations.set(conversation.id, store);
        this.tabs.addTab(conversation.id);
        void store.session.connect();
      }
    });
    this._loaded = true;
  }

  async createConversation(params: CreateConversationParams): Promise<Conversation> {
    const conversation = await rpc.conversations.createConversation(params);
    runInAction(() => {
      const store = new ConversationStore(conversation);
      this.conversations.set(params.id, store);
      this.tabs.addTab(params.id);
      this.tabs.setActiveTab(params.id);
      void store.session.connect();
    });
    return conversation;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const snapshot = this.conversations.get(conversationId);
    if (!snapshot) return;

    const previousTabOrder = this.tabs.tabOrder.slice();
    const previousActiveTabId = this.tabs.activeTabId;

    runInAction(() => {
      this.conversations.delete(conversationId);
      this.tabs.removeTab(conversationId);
    });

    try {
      await rpc.conversations.deleteConversation(this.projectId, this.taskId, conversationId);
      snapshot.dispose();
    } catch (err) {
      runInAction(() => {
        this.conversations.set(conversationId, snapshot);
        this.tabs.tabOrder = previousTabOrder;
        if (previousActiveTabId) this.tabs.setActiveTab(previousActiveTabId);
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

  reorderConversations(fromIndex: number, toIndex: number) {
    this.tabs.reorderTabs(fromIndex, toIndex);
  }
}

export type ConversationStatus = 'connecting' | 'ready';

export class ConversationStore {
  data: Conversation;
  session: PtySession;

  constructor(conversation: Conversation) {
    this.data = conversation;
    this.session = new PtySession(
      makePtySessionId(conversation.projectId, conversation.taskId, conversation.id)
    );
    makeAutoObservable(this);
  }

  dispose() {
    this.session.dispose();
  }
}
