import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import { makeFileLinkHandlers } from '@renderer/features/tasks/stores/open-file-in-file-editor';
import { events, rpc } from '@renderer/lib/ipc';
import { PtySession } from '@renderer/lib/pty/pty-session';
import type { IDisposable } from '@renderer/lib/stores/lifecycle';
import { Resource } from '@renderer/lib/stores/resource';
import { log } from '@renderer/utils/logger';
import { soundPlayer } from '@renderer/utils/soundPlayer';
import type { ConversationStatus } from '@shared/conversation-timeline';
import {
  type Conversation,
  type CreateConversationParams,
  shouldUseChatRuntime,
} from '@shared/conversations';
import {
  agentEventChannel,
  agentSessionExitedChannel,
  isAttentionNotification,
  type NotificationType,
} from '@shared/events/agentEvents';
import {
  conversationChangedChannel,
  conversationStatusEventChannel,
} from '@shared/events/conversationEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { ConversationTimelineStore } from './conversation-timeline-store';

export type AgentStatus = 'idle' | 'working' | 'awaiting-input' | 'error' | 'completed';

export class ConversationManagerStore implements IDisposable {
  private offAgentEvents: (() => void) | null = null;
  private offSessionExited: (() => void) | null = null;
  private offConversationChanges: (() => void) | null = null;
  private offConversationStatus: (() => void) | null = null;
  private readonly _disposeReaction: () => void;

  /** Data layer: plain Conversation records loaded from the main process. */
  readonly list: Resource<Conversation[]>;
  /** Runtime state stores keyed by conversation id — populated by reaction on list.data. */
  conversations = observable.map<string, ConversationStore>();
  /** Terminal session layer keyed by conversation id — connected lazily for terminal runtimes. */
  sessions = observable.map<string, PtySession>();
  /** Chat timeline layer keyed by conversation id — populated for chat runtimes. */
  timelines = observable.map<string, ConversationTimelineStore>();
  private readonly pendingStatuses = new Map<string, ConversationStatus>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    preloaded?: Conversation[]
  ) {
    makeObservable(this, {
      conversations: observable,
      sessions: observable,
      timelines: observable,
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
          this.applyPendingStatus(conversation.id);
          if (shouldCreateTerminalSession(conversation) && !this.sessions.has(conversation.id)) {
            this.sessions.set(conversation.id, this.createSession(conversation));
          }
          if (shouldCreateChatTimeline(conversation) && !this.timelines.has(conversation.id)) {
            this.timelines.set(conversation.id, this.createTimeline(conversation));
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
            this.applyPendingStatus(conversation.id);
            if (shouldCreateTerminalSession(conversation) && !this.sessions.has(conversation.id)) {
              this.sessions.set(conversation.id, this.createSession(conversation));
            } else if (!shouldCreateTerminalSession(conversation)) {
              this.sessions.get(conversation.id)?.dispose();
              this.sessions.delete(conversation.id);
            }
            if (shouldCreateChatTimeline(conversation) && !this.timelines.has(conversation.id)) {
              this.timelines.set(conversation.id, this.createTimeline(conversation));
            } else if (!shouldCreateChatTimeline(conversation)) {
              this.timelines.get(conversation.id)?.dispose();
              this.timelines.delete(conversation.id);
            }
          }
        });
      },
      { fireImmediately: true }
    );

    this.offAgentEvents = this.listenToAgentEvents();
    this.offSessionExited = this.listenToSessionExited();
    this.offConversationChanges = this.listenToConversationChanges();
    this.offConversationStatus = this.listenToConversationStatus();
  }

  private listenToAgentEvents(): () => void {
    return events.on(agentEventChannel, ({ event, appFocused }) => {
      if (event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      if (shouldUseChatRuntime(conversationStore.data)) return;
      if (event.type === 'start') {
        conversationStore.setWorking();
        return;
      }
      if (event.type === 'notification') {
        const nt = event.payload.notificationType;
        if (!isAttentionNotification(nt)) return;
        if ((event.providerId === 'codex' || event.providerId === 'amp') && nt === 'idle_prompt') {
          if (conversationStore.status === 'working') {
            conversationStore.setStatus('completed');
            soundPlayer.play('task_complete', appFocused);
          }
          return;
        }
        conversationStore.setAwaitingInput(nt);
        soundPlayer.play('needs_attention', appFocused);
        return;
      }
      if (event.type === 'stop') {
        if (conversationStore.status !== 'working') return;
        conversationStore.setStatus('completed');
        soundPlayer.play('task_complete', appFocused);
        return;
      }
      if (event.type === 'error') {
        conversationStore.setStatus('error');
      }
    });
  }

  private listenToSessionExited(): () => void {
    return events.on(agentSessionExitedChannel, (event) => {
      if (event.taskId !== this.taskId) return;
      const conversationStore = this.conversations.get(event.conversationId);
      if (!conversationStore) return;
      if (shouldUseChatRuntime(conversationStore.data)) return;
      conversationStore.clearWorking();
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

  private listenToConversationStatus(): () => void {
    return events.on(conversationStatusEventChannel, (event) => {
      if (event.projectId !== this.projectId || event.taskId !== this.taskId) return;
      const store = this.conversations.get(event.conversationId);
      if (!store) {
        this.pendingStatuses.set(event.conversationId, event.status);
        return;
      }
      store.setStatus(event.status);
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
      if (!this.conversations.has(conversation.id)) {
        this.conversations.set(conversation.id, new ConversationStore(conversation));
      }
      if (shouldCreateTerminalSession(conversation) && !this.sessions.has(conversation.id)) {
        this.sessions.set(conversation.id, this.createSession(conversation));
      }
      if (shouldCreateChatTimeline(conversation) && !this.timelines.has(conversation.id)) {
        this.timelines.set(conversation.id, this.createTimeline(conversation));
      }
      const appliedPendingStatus = this.applyPendingStatus(conversation.id);
      if (
        !appliedPendingStatus &&
        params.initialPrompt?.trim() &&
        (shouldCreateTerminalSession(conversation) || shouldUseChatRuntime(conversation))
      ) {
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
    const conversation = this.conversations.get(conversationId)?.data;
    if (!conversation) return;
    runInAction(() => {
      if (shouldCreateTerminalSession(conversation) && !this.sessions.has(conversationId)) {
        this.sessions.set(conversationId, this.createSession(conversation));
      }
      if (shouldCreateChatTimeline(conversation) && !this.timelines.has(conversationId)) {
        this.timelines.set(conversationId, this.createTimeline(conversation));
      }
    });
  }

  async dehydrateConversation(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    const timeline = this.timelines.get(conversationId);
    await rpc.conversations.dehydrateConversation(this.projectId, this.taskId, conversationId);
    session?.dispose();
    timeline?.dispose();
    runInAction(() => {
      this.sessions.delete(conversationId);
      this.timelines.delete(conversationId);
    });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    const store = this.conversations.get(conversationId);
    const session = this.sessions.get(conversationId);
    const timeline = this.timelines.get(conversationId);
    if (!store) return;

    runInAction(() => {
      this.conversations.delete(conversationId);
      this.sessions.delete(conversationId);
      this.timelines.delete(conversationId);
      this.pendingStatuses.delete(conversationId);
    });

    try {
      await rpc.conversations.deleteConversation(this.projectId, this.taskId, conversationId);
      session?.dispose();
      timeline?.dispose();
    } catch (err) {
      runInAction(() => {
        this.conversations.set(conversationId, store);
        if (session) this.sessions.set(conversationId, session);
        if (timeline) this.timelines.set(conversationId, timeline);
      });
      throw err;
    }
  }

  async sendMessage(conversationId: string, text: string): Promise<void> {
    const timeline = this.timelines.get(conversationId);
    if (!timeline) throw new Error('Conversation timeline not found');
    await timeline.sendMessage(text);
  }

  async cancelTurn(conversationId: string): Promise<void> {
    const timeline = this.timelines.get(conversationId);
    if (!timeline) throw new Error('Conversation timeline not found');
    await timeline.cancelTurn();
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
    this.offAgentEvents?.();
    this.offAgentEvents = null;
    this.offSessionExited?.();
    this.offSessionExited = null;
    this.offConversationChanges?.();
    this.offConversationChanges = null;
    this.offConversationStatus?.();
    this.offConversationStatus = null;
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    for (const timeline of this.timelines.values()) {
      timeline.dispose();
    }
    this.pendingStatuses.clear();
  }

  private createSession(conversation: Conversation): PtySession {
    const handlers = makeFileLinkHandlers(conversation.projectId, conversation.taskId);
    return new PtySession(
      makePtySessionId(conversation.projectId, conversation.taskId, conversation.id),
      undefined,
      handlers.onOpenFile,
      handlers.onOpenExternal
    );
  }

  private createTimeline(conversation: Conversation): ConversationTimelineStore {
    return new ConversationTimelineStore(
      conversation.projectId,
      conversation.taskId,
      conversation.id
    );
  }

  private applyPendingStatus(conversationId: string): boolean {
    const status = this.pendingStatuses.get(conversationId);
    if (!status) return false;
    const store = this.conversations.get(conversationId);
    if (!store) return false;
    this.pendingStatuses.delete(conversationId);
    store.setStatus(status);
    return true;
  }
}

function shouldCreateTerminalSession(conversation: Conversation): boolean {
  return !shouldUseChatRuntime(conversation);
}

function shouldCreateChatTimeline(conversation: Conversation): boolean {
  return shouldUseChatRuntime(conversation);
}

export class ConversationStore {
  data: Conversation;
  status: AgentStatus = 'idle';
  seen = true;
  lastNotificationType: NotificationType | null = null;

  constructor(conversation: Conversation) {
    this.data = conversation;
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
    if (this.status === 'working') {
      this.setStatus('idle');
    }
  }

  markSeen() {
    this.seen = true;
  }

  dispose() {
    // Session is managed by ConversationManagerStore.sessions — nothing to do here.
  }
}
