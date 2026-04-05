import { action, computed, makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import { Conversation, CreateConversationParams } from '@shared/conversations';
import {
  agentEventChannel,
  agentSessionExitedChannel,
  NotificationType,
} from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { events, rpc } from '@renderer/core/ipc';
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

type AttentionNotificationType = Exclude<NotificationType, 'auth_success'>;

const ATTENTION_NOTIFICATION_TYPES = new Set<NotificationType>([
  'permission_prompt',
  'idle_prompt',
  'elicitation_dialog',
]);

function isAttentionNotificationType(type: NotificationType): type is AttentionNotificationType {
  return ATTENTION_NOTIFICATION_TYPES.has(type);
}

export type ConversationStatus =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'notification'; notificationType: AttentionNotificationType }
  | { kind: 'error' }
  | { kind: 'stop' };

export type TaskAgentStatus = 'notification' | 'working' | 'error' | 'stop' | null;

function shouldStartUnseen(status: ConversationStatus): boolean {
  return status.kind === 'notification' || status.kind === 'error' || status.kind === 'stop';
}

export class ConversationManagerStore
  implements
    TabViewProvider<ConversationStore, CreateConversationParams>,
    Snapshottable<TabViewSnapshot>
{
  private _loaded = false;
  private isVisible = false;
  private offAgentEvents: (() => void) | null = null;
  private offSessionExited: (() => void) | null = null;
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
      setConversationWorking: action,
      setVisible: action,
      setNextTabActive: action,
      setPreviousTabActive: action,
      setTabActiveIndex: action,
      setActiveTab: action,
      taskStatus: computed,
    });
    onBecomeObserved(this, 'tabOrder', () => {
      if (this._loaded) return;
      this.load();
    });
    this.offAgentEvents = events.on(agentEventChannel, ({ event }) => {
      if (event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      if (event.type === 'notification') {
        const nt = event.payload.notificationType;
        if (!nt || !isAttentionNotificationType(nt)) return;
        conversationStore.setStatus({ kind: 'notification', notificationType: nt });
        this.markSeenIfActiveAndVisible(conversationStore.data.id, conversationStore);
        return;
      }
      if (event.type === 'stop') {
        conversationStore.setStatus({ kind: 'stop' });
        this.markSeenIfActiveAndVisible(conversationStore.data.id, conversationStore);
        return;
      }
      if (event.type === 'error') {
        conversationStore.setStatus({ kind: 'error' });
        this.markSeenIfActiveAndVisible(conversationStore.data.id, conversationStore);
        return;
      }
      if (event.type === 'working') {
        conversationStore.setWorking();
      }
    });
    this.offSessionExited = events.on(agentSessionExitedChannel, (event) => {
      if (event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      conversationStore.clearWorking();
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
    this.activeTab?.markSeen();
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible;
  }

  setConversationWorking(conversationId: string): void {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;
    conversation.setWorking();
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
      this.conversations.set(conversation.id, store);
      addTabId(this, conversation.id);
      this.setActiveTab(conversation.id);
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

  get taskStatus(): TaskAgentStatus {
    let hasWorking = false;
    let hasUnseenError = false;
    let hasUnseenStop = false;
    for (const conversation of this.conversations.values()) {
      if (!conversation.seen && conversation.status.kind === 'notification') return 'notification';
      if (conversation.status.kind === 'working') hasWorking = true;
      if (!conversation.seen && conversation.status.kind === 'error') hasUnseenError = true;
      if (!conversation.seen && conversation.status.kind === 'stop') hasUnseenStop = true;
    }
    if (hasWorking) return 'working';
    if (hasUnseenError) return 'error';
    if (hasUnseenStop) return 'stop';
    return null;
  }

  dispose(): void {
    this.offAgentEvents?.();
    this.offAgentEvents = null;
    this.offSessionExited?.();
    this.offSessionExited = null;
    for (const conversation of this.conversations.values()) {
      conversation.dispose();
    }
  }

  private markSeenIfActiveAndVisible(
    conversationId: string,
    conversationStore: ConversationStore
  ): void {
    if (this.isVisible && this.activeTabId === conversationId) {
      conversationStore.markSeen();
    }
  }
}

export class ConversationStore {
  data: Conversation;
  session: PtySession;
  status: ConversationStatus = { kind: 'idle' };
  seen = true;

  constructor(conversation: Conversation) {
    this.data = conversation;
    this.session = new PtySession(
      makePtySessionId(conversation.projectId, conversation.taskId, conversation.id)
    );
    makeObservable(this, {
      data: observable,
      session: observable,
      status: observable.ref,
      seen: observable,
      setStatus: action,
      setWorking: action,
      clearWorking: action,
      markSeen: action,
    });
  }

  setStatus(status: ConversationStatus) {
    this.status = status;
    this.seen = !shouldStartUnseen(status);
  }

  setWorking() {
    this.setStatus({ kind: 'working' });
  }

  clearWorking() {
    if (this.status.kind === 'working') {
      this.setStatus({ kind: 'idle' });
    }
  }

  markSeen() {
    this.seen = true;
  }

  dispose() {
    this.session.dispose();
  }
}
