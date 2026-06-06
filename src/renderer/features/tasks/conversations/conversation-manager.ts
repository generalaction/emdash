import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import { makeFileLinkHandlers } from '@renderer/features/tasks/stores/open-file-in-file-editor';
import { events, rpc } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';
import type { IDisposable } from '@renderer/lib/stores/lifecycle';
import { Resource } from '@renderer/lib/stores/resource';
import { log } from '@renderer/utils/logger';
import { soundPlayer } from '@renderer/utils/soundPlayer';
import { type Conversation, type CreateConversationParams } from '@shared/conversations';
import {
  agentSessionExitedChannel,
  type AgentStatus,
  type NotificationType,
} from '@shared/events/agentEvents';
import {
  conversationAgentStatusChangedChannel,
  conversationChangedChannel,
  conversationCreatedChannel,
} from '@shared/events/conversationEvents';
import { makePtySessionId } from '@shared/ptySessionId';

export type { AgentStatus } from '@shared/events/agentEvents';

export class ConversationManagerStore implements IDisposable {
  private offAgentStatusChanged: (() => void) | null = null;
  private offSessionExited: (() => void) | null = null;
  private offConversationCreated: (() => void) | null = null;
  private offConversationChanges: (() => void) | null = null;
  private readonly _disposeReaction: () => void;

  /** Data layer: plain Conversation records loaded from the main process. */
  readonly list: Resource<Conversation[]>;
  /** Runtime state stores keyed by conversation id — populated by reaction on list.data. */
  conversations = observable.map<string, ConversationStore>();
  /** Session layer keyed by conversation id — created alongside data, connected lazily. */
  sessions = observable.map<string, PtySession>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    preloaded?: Conversation[]
  ) {
    makeObservable(this, {
      conversations: observable,
      sessions: observable,
      taskStatus: computed,
    });

    const hasPreloaded = preloaded !== undefined;
    this.list = new Resource<Conversation[]>(
      hasPreloaded ? null : () => rpc.conversations.getConversationsForTask(projectId, taskId),
      hasPreloaded ? [] : [{ kind: 'demand' }],
      hasPreloaded ? { init: preloaded } : undefined
    );

    // When preloaded data is available, populate the maps synchronously so
    // they are accessible immediately — even when this constructor is called
    // from within a MobX action, where reaction callbacks (including
    // fireImmediately) are deferred until the outermost action completes.
    if (preloaded) {
      runInAction(() => {
        for (const conversation of preloaded) {
          if (!this.conversations.has(conversation.id)) {
            this.conversations.set(conversation.id, new ConversationStore(conversation));
          }
          if (!this.sessions.has(conversation.id)) {
            this.sessions.set(conversation.id, this.createSession(conversation));
          }
        }
      });
    }

    // Sync conversations and sessions maps whenever resource data changes.
    // fireImmediately handles the non-preloaded case; for preloaded data the
    // maps are already populated above so this is a no-op on first run.
    this._disposeReaction = reaction(
      () => this.list.data,
      (data) => {
        if (!data) return;
        runInAction(() => {
          for (const conversation of data) {
            if (!this.conversations.has(conversation.id)) {
              this.conversations.set(conversation.id, new ConversationStore(conversation));
            }
            if (!this.sessions.has(conversation.id)) {
              this.sessions.set(conversation.id, this.createSession(conversation));
            }
          }
        });
      },
      { fireImmediately: true }
    );

    this.offAgentStatusChanged = this.listenToAgentStatusChanged();
    this.offSessionExited = this.listenToSessionExited();
    this.offConversationCreated = this.listenToConversationCreated();
    this.offConversationChanges = this.listenToConversationChanges();
  }

  private addConversation(conversation: Conversation): void {
    const existing = this.conversations.get(conversation.id);
    if (existing) {
      // Reconcile optimistic records (e.g. task creation seeds a Conversation
      // before the main process decides fields like uiMode) with the
      // authoritative data from the main process.
      Object.assign(existing.data, conversation);
    } else {
      this.conversations.set(conversation.id, new ConversationStore(conversation));
    }
    if (!this.sessions.has(conversation.id)) {
      this.sessions.set(conversation.id, this.createSession(conversation));
    }
  }

  private listenToAgentStatusChanged(): () => void {
    return events.on(conversationAgentStatusChangedChannel, (payload) => {
      if (payload.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(payload.conversationId);
      if (!conversationStore) return;

      runInAction(() => {
        conversationStore.status = payload.status;
        conversationStore.seen = payload.seen;
        if (payload.status !== 'awaiting-input') {
          conversationStore.lastNotificationType = null;
        }
      });

      if (payload.soundEvent) {
        soundPlayer.play(payload.soundEvent, true);
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

  private listenToConversationCreated(): () => void {
    return events.on(conversationCreatedChannel, ({ conversation }) => {
      if (conversation.taskId !== this.taskId || conversation.projectId !== this.projectId) return;
      runInAction(() => {
        this.addConversation(conversation);
      });
    });
  }

  private listenToConversationChanges(): () => void {
    return events.on(conversationChangedChannel, (event) => {
      if (event.taskId !== this.taskId) return;
      const store = this.conversations.get(event.conversationId);
      if (!store) return;
      runInAction(() => {
        Object.assign(store.data, event.changes);
      });
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

  async createConversation(params: CreateConversationParams): Promise<Conversation> {
    const conversation = await rpc.conversations.createConversation(params);
    runInAction(() => {
      this.addConversation(conversation);
      if (params.initialPrompt?.trim()) {
        this.conversations.get(conversation.id)?.setWorking();
      }
    });
    return conversation;
  }

  async markConversationWorking(conversationId: string): Promise<void> {
    if (!this.list.data) {
      await this.list.load();
    }

    runInAction(() => {
      const store = this.conversations.get(conversationId);
      if (!store) {
        log.warn(`ConversationManagerStore: conversation ${conversationId} not found after load`, {
          projectId: this.projectId,
          taskId: this.taskId,
        });
        return;
      }
      store.setWorking();
    });
  }

  async hydrateConversation(conversationId: string): Promise<void> {
    await rpc.conversations.hydrateConversation(this.projectId, this.taskId, conversationId);
  }

  async dehydrateConversation(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    session?.dispose();
    await rpc.conversations.dehydrateConversation(this.projectId, this.taskId, conversationId);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const store = this.conversations.get(conversationId);
    const session = this.sessions.get(conversationId);
    if (!store) return;

    runInAction(() => {
      this.conversations.delete(conversationId);
      this.sessions.delete(conversationId);
    });

    try {
      await rpc.conversations.deleteConversation(this.projectId, this.taskId, conversationId);
      session?.destroy();
    } catch (err) {
      runInAction(() => {
        this.conversations.set(conversationId, store);
        if (session) this.sessions.set(conversationId, session);
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
    this._disposeReaction();
    this.offAgentStatusChanged?.();
    this.offAgentStatusChanged = null;
    this.offSessionExited?.();
    this.offSessionExited = null;
    this.offConversationCreated?.();
    this.offConversationCreated = null;
    this.offConversationChanges?.();
    this.offConversationChanges = null;
    for (const session of this.sessions.values()) {
      session.destroy();
    }
  }

  private createSession(conversation: Conversation): PtySession {
    const handlers = makeFileLinkHandlers(conversation.projectId, conversation.taskId);
    return new PtySession(
      makePtySessionId(conversation.projectId, conversation.taskId, conversation.id),
      undefined,
      handlers.onOpenFile,
      handlers.onOpenExternal,
      { clearOnBackendStart: true }
    );
  }
}

export class ConversationStore {
  data: Conversation;
  status: AgentStatus;
  seen: boolean;
  lastNotificationType: NotificationType | null = null;

  constructor(conversation: Conversation) {
    this.data = conversation;
    this.status = conversation.agentStatus ?? 'idle';
    this.seen = conversation.agentStatusSeen ?? true;
    makeObservable(this, {
      data: observable,
      status: observable,
      seen: observable,
      lastNotificationType: observable,
      setStatus: action,
      setAwaitingInput: action,
      setWorking: action,
      clearWorking: action,
      markSeen: action,
      isInitialConversation: computed,
      indicatorStatus: computed,
    });
  }

  get isInitialConversation(): boolean {
    return this.data.isInitialConversation === true;
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
    if (status !== 'awaiting-input') {
      this.lastNotificationType = null;
    }
  }

  setAwaitingInput(notificationType: NotificationType) {
    this.lastNotificationType = notificationType;
    this.setStatus('awaiting-input');
  }

  setWorking() {
    if (this.status === 'awaiting-input' && this.lastNotificationType === 'permission_prompt') {
      return;
    }
    this.lastNotificationType = null;
    this.setStatus('working');
  }

  clearWorking() {
    if (this.status === 'working' || this.status === 'awaiting-input') {
      this.setStatus('idle');
    }
  }

  markSeen() {
    this.seen = true;
    void rpc.conversations.markConversationSeen(this.data.id);
  }

  dispose() {
    // Session is managed by ConversationManagerStore.sessions — nothing to do here.
  }
}
