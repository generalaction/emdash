import { action, computed, makeObservable, observable, onBecomeObserved, runInAction } from 'mobx';
import { Conversation, CreateConversationParams } from '@shared/conversations';
import {
  agentEventChannel,
  agentSessionExitedChannel,
  isAttentionNotification,
} from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { events, rpc } from '@renderer/core/ipc';
import { soundPlayer } from '@renderer/lib/soundPlayer';
import { PtySession } from './pty-session';

export type AgentStatus = 'idle' | 'working' | 'awaiting-input' | 'error' | 'completed';

export class ConversationManagerStore {
  private _loaded = false;
  private offAgentEvents: (() => void) | null = null;
  private offSessionExited: (() => void) | null = null;
  conversations = observable.map<string, ConversationStore>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string
  ) {
    makeObservable(this, {
      conversations: observable,
      taskStatus: computed,
    });
    onBecomeObserved(this, 'conversations', () => {
      if (this._loaded) return;
      this.load();
    });
    this.offAgentEvents = this.listenToAgentEvents();
    this.offSessionExited = this.listenToSessionExited();
  }

  private listenToAgentEvents(): () => void {
    return events.on(agentEventChannel, ({ event, appFocused }) => {
      if (event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      if (event.type === 'notification') {
        const nt = event.payload.notificationType;
        if (!isAttentionNotification(nt)) return;
        conversationStore.setStatus('awaiting-input');
        soundPlayer.play('needs_attention', appFocused);
        return;
      }
      if (event.type === 'stop') {
        conversationStore.setStatus('completed');
        soundPlayer.play('task_complete', appFocused);
        return;
      }
      if (event.type === 'error') {
        conversationStore.setStatus('error');
        return;
      }
    });
  }

  private listenToSessionExited(): () => void {
    return events.on(agentSessionExitedChannel, (event) => {
      if (event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      conversationStore.clearWorking();
    });
  }

  get taskStatus(): AgentStatus | null {
    let hasWorking = false;
    let hasUnseenError = false;
    let hasUnseenCompleted = false;
    for (const conversation of this.conversations.values()) {
      if (!conversation.seen && conversation.status === 'awaiting-input') return 'awaiting-input';
      if (conversation.status === 'working') hasWorking = true;
      if (!conversation.seen && conversation.status === 'error') hasUnseenError = true;
      if (!conversation.seen && conversation.status === 'completed') hasUnseenCompleted = true;
    }
    if (hasWorking) return 'working';
    if (hasUnseenError) return 'error';
    if (hasUnseenCompleted) return 'completed';
    return null;
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
        void store.session.connect();
      }
    });
  }

  async createConversation(params: CreateConversationParams): Promise<Conversation> {
    const conversation = await rpc.conversations.createConversation(params);
    runInAction(() => {
      const store = new ConversationStore(conversation);
      this.conversations.set(conversation.id, store);
      void store.session.connect();
    });
    return conversation;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const snapshot = this.conversations.get(conversationId);
    if (!snapshot) return;

    runInAction(() => {
      this.conversations.delete(conversationId);
    });

    try {
      await rpc.conversations.deleteConversation(this.projectId, this.taskId, conversationId);
      snapshot.dispose();
    } catch (err) {
      runInAction(() => {
        this.conversations.set(conversationId, snapshot);
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

  dispose(): void {
    this.offAgentEvents?.();
    this.offAgentEvents = null;
    this.offSessionExited?.();
    this.offSessionExited = null;
    for (const conversation of this.conversations.values()) {
      conversation.dispose();
    }
  }
}

export class ConversationStore {
  data: Conversation;
  session: PtySession;
  status: AgentStatus = 'idle';
  seen = true;

  constructor(conversation: Conversation) {
    this.data = conversation;
    this.session = new PtySession(
      makePtySessionId(conversation.projectId, conversation.taskId, conversation.id)
    );
    makeObservable(this, {
      data: observable,
      session: observable,
      status: observable,
      seen: observable,
      setStatus: action,
      setWorking: action,
      clearWorking: action,
      markSeen: action,
      indicatorStatus: computed,
    });
  }

  get indicatorStatus(): AgentStatus | null {
    if (this.status === 'working') return 'working';
    if (this.seen) return null;
    if (this.status === 'awaiting-input') return 'awaiting-input';
    if (this.status === 'error') return 'error';
    if (this.status === 'completed') return 'completed';
    return null;
  }

  setStatus(status: AgentStatus) {
    this.status = status;
    this.seen = status === 'idle' || status === 'working';
  }

  setWorking() {
    this.setStatus('working');
  }

  clearWorking() {
    if (this.status === 'working') {
      this.setStatus('idle');
    }
  }

  markSeen() {
    this.seen = true;
  }

  dispose() {
    this.session.dispose();
  }
}
