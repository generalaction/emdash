import { acpApiContract, type SessionSummary } from '@emdash/core/runtimes/acp/api/client';
import { tuiAgentsContract, type TuiSessionList } from '@emdash/core/runtimes/tui-agents/api';
import type { Disposable } from '@emdash/shared/concurrency';
import { createLiveModelReplica, ReplicaLog } from '@emdash/wire';
import type { Terminal } from '@xterm/xterm';
import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
// TODO(conversations-extraction): Inject file-link handlers instead of importing task editor plumbing.
import { makeFileLinkHandlers } from '@renderer/features/tasks/stores/open-file-in-file-editor';
import { events, rpc } from '@renderer/lib/ipc';
import type { FrontendPtyConnector } from '@renderer/lib/pty/pty';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { createXtermLogSink } from '@renderer/lib/pty/xterm-log-sink';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { getTuiAgentsRuntimeClient } from '@renderer/lib/runtime/tui-agents-client';
import { Resource } from '@renderer/lib/stores/resource';
import { type AgentStatus, type NotificationType } from '@shared/core/agents/agentEvents';
import {
  conversationAgentStatusChangedChannel,
  conversationChangedChannel,
  conversationCreatedChannel,
} from '@shared/core/conversations/conversationEvents';
import {
  type Conversation,
  type CreateConversationParams,
} from '@shared/core/conversations/conversations';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';

export class ConversationManagerStore implements Disposable {
  private offAgentStatusChanged: (() => void) | null = null;
  private offTuiSessionState: (() => void) | null = null;
  private offAcpSessionState: (() => void) | null = null;
  private offConversationCreated: (() => void) | null = null;
  private offConversationChanges: (() => void) | null = null;
  private readonly _disposeReaction: () => void;

  /** Data layer: plain Conversation records loaded from the main process. */
  readonly list: Resource<Conversation[]>;
  /** Runtime state stores keyed by conversation id — populated by reaction on list.data. */
  conversations = observable.map<string, ConversationStore>();
  /** Session layer keyed by conversation id — created alongside data, connected lazily. */
  sessions = observable.map<string, PtySession>();
  activeTuiSessionIds = observable.set<string>();
  activeAcpSessionIds = observable.set<string>();

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    preloaded?: Conversation[]
  ) {
    makeObservable(this, {
      conversations: observable,
      sessions: observable,
      activeTuiSessionIds: observable,
      activeAcpSessionIds: observable,
      activeSessionIds: computed,
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
    this.offTuiSessionState = this.listenToTuiSessionState();
    this.offAcpSessionState = this.listenToAcpSessionState();
    this.offConversationCreated = this.listenToConversationCreated();
    this.offConversationChanges = this.listenToConversationChanges();
  }

  private addConversation(conversation: Conversation): void {
    if (!this.conversations.has(conversation.id)) {
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
    });
  }

  private listenToTuiSessionState(): () => void {
    if (typeof window === 'undefined') return () => {};
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const client = await getTuiAgentsRuntimeClient();
      if (disposed) return;
      const replica = createLiveModelReplica(tuiAgentsContract.sessions, client.sessions, {
        onChange: {
          list: (list: TuiSessionList) => this.handleTuiSessionListChanged(list),
        },
      });
      const lease = replica.acquire(undefined);
      cleanup = () => {
        void lease.release();
        void replica.dispose();
      };
      await lease.ready();
      if (disposed) cleanup();
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }

  private handleTuiSessionListChanged(list: TuiSessionList): void {
    runInAction(() => {
      this.activeTuiSessionIds.clear();
      for (const [conversationId, session] of Object.entries(list)) {
        if (session.status === 'starting' || session.status === 'running') {
          this.activeTuiSessionIds.add(conversationId);
        }
      }
    });
  }

  private listenToAcpSessionState(): () => void {
    if (typeof window === 'undefined') return () => {};
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const client = (await getDesktopWireClient()).acp;
      if (disposed) return;
      const replica = createLiveModelReplica(acpApiContract.sessions, client.sessions, {
        onChange: {
          list: (list: Record<string, SessionSummary>) => this.handleAcpSessionListChanged(list),
        },
      });
      const lease = replica.acquire(undefined);
      cleanup = () => {
        void lease.release();
        void replica.dispose();
      };
      await lease.ready();
      if (disposed) cleanup();
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }

  private handleAcpSessionListChanged(list: Record<string, SessionSummary>): void {
    runInAction(() => {
      this.activeAcpSessionIds.clear();
      for (const [conversationId, session] of Object.entries(list)) {
        if (session.lifecycle !== 'closed') {
          this.activeAcpSessionIds.add(conversationId);
        }
      }
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

  get activeSessionIds(): Set<string> {
    return new Set([...this.activeTuiSessionIds, ...this.activeAcpSessionIds]);
  }

  isSessionActive(conversationId: string): boolean {
    return (
      this.activeTuiSessionIds.has(conversationId) || this.activeAcpSessionIds.has(conversationId)
    );
  }

  async createConversation(params: CreateConversationParams): Promise<Conversation> {
    const conversation = await rpc.conversations.createConversation(params);
    runInAction(() => {
      this.addConversation(conversation);
    });
    return conversation;
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

  async killSession(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return;
    const client = await getDesktopWireClient();
    const result =
      conversation.data.type === 'acp'
        ? await client.acp.killSession({ conversationId })
        : await client.tuiAgents.killSession({ conversationId });
    if (!result.success) {
      throw new Error(result.error.message ?? `Failed to kill session '${conversationId}'`);
    }
    runInAction(() => {
      this.activeAcpSessionIds.delete(conversationId);
      this.activeTuiSessionIds.delete(conversationId);
    });
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
    this.offTuiSessionState?.();
    this.offTuiSessionState = null;
    this.offAcpSessionState?.();
    this.offAcpSessionState = null;
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
    const connector =
      conversation.type === 'acp'
        ? createNoopConnector()
        : createTuiAgentsConnector(conversation.id);
    return new PtySession(
      makePtySessionId(conversation.projectId, conversation.taskId, conversation.id),
      undefined,
      handlers.onOpenFile,
      handlers.onOpenExternal,
      connector
    );
  }
}

function createNoopConnector(): FrontendPtyConnector {
  return {
    connect() {
      return () => {};
    },
  };
}

function createTuiAgentsConnector(conversationId: string): FrontendPtyConnector {
  let logBinding: ReplicaLog | null = null;
  let clientPromise: ReturnType<typeof getTuiAgentsRuntimeClient> | null = null;
  const client = () => {
    clientPromise ??= getTuiAgentsRuntimeClient();
    return clientPromise;
  };
  return {
    async connect(terminal: Terminal) {
      const runtime = await client();
      logBinding = new ReplicaLog(runtime.output.handle({ conversationId }), {
        store: createXtermLogSink(terminal),
      });
      await logBinding.ready;
      return () => {
        void logBinding?.dispose();
        logBinding = null;
      };
    },
    sendInput(data: string) {
      void client().then((runtime) => runtime.sendInput({ conversationId, data }));
    },
    resize(cols: number, rows: number) {
      void client().then((runtime) => runtime.resize({ conversationId, cols, rows }));
    },
  };
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
