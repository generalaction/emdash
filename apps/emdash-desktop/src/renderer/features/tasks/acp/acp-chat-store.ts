import type {
  ChatContext,
  ChatImageAttachment,
  ChatItem,
  ChatMessage,
  ChatState,
  ChatView,
  ScrollMode,
} from '@emdash/chat-ui';
import { applyTurnEvent, createChatState } from '@emdash/chat-ui';
import type { AgentUpdate, AcpPromptImage, AcpTurn, TerminalSnapshot } from '@emdash/core/acp';
import {
  SessionMachine,
  toSessionSnapshot,
  type SessionSnapshot,
} from '@emdash/core/acp/session-machine';
import type { ComposerModelOption } from '@emdash/ui/react/components';
import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { getSharedChatContext } from '@renderer/lib/chat/shared-chat-context';
import { events, rpc } from '@renderer/lib/ipc';
import {
  acpSessionClosedChannel,
  acpSessionStateChannel,
  acpSessionUpdateChannel,
  acpTerminalCreatedChannel,
  acpTerminalExitChannel,
  acpTerminalOutputChannel,
  acpTerminalReleasedChannel,
  acpTurnCommittedChannel,
} from '@shared/core/acp/acpEvents';
import { foldHistory, foldTurn, mapAgentUpdate } from './acp-update-mapper';

export type AcpChatLifecycle = 'idle' | SessionSnapshot['lifecycle'];

/** Which UI actions are currently available given the machine state. */
export interface AgentAffordances {
  isWorking: boolean;
  isBusy: boolean;
  hasPendingPermission: boolean;
  canSubmit: boolean;
  canCancel: boolean;
}

export class AcpChatStore {
  readonly conversationId: string;
  readonly projectId: string;
  readonly taskId: string;

  /** Global services (theme, caches, highlighter). Owned by this store. */
  readonly chatContext: ChatContext;
  /** Per-conversation state (transcript + parse caches). Owned by this store. */
  readonly chatState: ChatState;

  /** Current session snapshot from IPC, null until bootstrapped. */
  snapshot: SessionSnapshot | null = null;

  terminals: TerminalSnapshot[] = [];

  /** True while the initial history fetch is in flight. Drives the "Loading chat..." overlay. */
  historyLoading = true;

  /** Total item count across committed history and active turn. Drives the "No messages" empty state. */
  messageCount = 0;

  /** Buffered active-turn updates, keyed by seq, until the initial state fetch completes. */
  private _activeTurnUpdates = new Map<number, { seq: number; update: AgentUpdate }>();
  /** The current active turn id (null when idle). */
  private _activeTurnId: string | null = null;

  /** The currently-active view handle. Bound by AcpChatPanel; used for declarative scroll. */
  private _view: ChatView | null = null;
  /** Temp id of the optimistic user message; cleared when the server echo replaces it. */
  private _optimisticUserId: string | null = null;

  private readonly _machine: SessionMachine;
  private _bootstrapped = false;

  private readonly _unsubs: Array<() => void> = [];

  constructor(conversationId: string, projectId: string, taskId: string) {
    this.conversationId = conversationId;
    this.projectId = projectId;
    this.taskId = taskId;

    this._machine = new SessionMachine(conversationId);

    // Use the process-long shared ChatContext (created once in main.tsx bootstrap).
    // Per-conversation transcript state lives in ChatState, created here.
    this.chatContext = getSharedChatContext();
    this.chatState = createChatState(this.chatContext);

    makeObservable(this, {
      snapshot: observable.ref,
      terminals: observable,
      historyLoading: observable,
      messageCount: observable,
      affordances: computed,
      lifecycle: computed,
      model: computed,
      modelOptions: computed,
      isEmpty: computed,
      permissionQueue: computed,
      lastStopReason: computed,
      usage: computed,
      applySnapshot: action,
      submitPrompt: action,
      stop: action,
      setModel: action,
      resolvePermission: action,
    });
  }

  // ── Derived state ──────────────────────────────────────────────────────────

  /** Coarse lifecycle — 'idle' until the first snapshot arrives. */
  get lifecycle(): AcpChatLifecycle {
    return this.snapshot?.lifecycle ?? 'idle';
  }

  /**
   * Currently selected model derived from configOptions (category === 'model').
   * Null if the agent doesn't report a model config option.
   */
  get model(): string | null {
    return this._extractModel(this.snapshot?.configOptions ?? []);
  }

  /**
   * All available model options as a ComposerModelOption record keyed by model id.
   * Null when the agent doesn't report any model config option (hides the selector).
   */
  get modelOptions(): Record<string, ComposerModelOption> | null {
    const opt = (this.snapshot?.configOptions ?? []).find(
      (o) => o.category === 'model' && o.type === 'select'
    );
    if (!opt || !('options' in opt) || !Array.isArray(opt.options)) return null;
    const result: Record<string, ComposerModelOption> = {};
    for (const o of opt.options as Array<{
      value: string;
      name: string;
      description?: string | null;
    }>) {
      result[o.value] = { name: o.name, description: o.description ?? undefined };
    }
    return result;
  }

  /** True when history has loaded and there are no messages. Drives the "No messages" overlay. */
  get isEmpty(): boolean {
    return !this.historyLoading && this.messageCount === 0;
  }

  /** FIFO queue of pending permission requests awaiting user resolution. */
  get permissionQueue(): SessionSnapshot['pendingPermissions'] {
    return this.snapshot?.pendingPermissions ?? [];
  }

  /** The stop reason from the last completed turn. Used for notice bands. */
  get lastStopReason(): string | null {
    return this.snapshot?.lastStopReason ?? null;
  }

  /** Latest context-window and cost figures; null until the first usage_update arrives. */
  get usage(): SessionSnapshot['usage'] {
    return this.snapshot?.usage ?? null;
  }

  /** Derived UI affordances — stable reference when snapshot inputs are unchanged. */
  get affordances(): AgentAffordances {
    // Reading `this.snapshot` registers MobX reactivity on the snapshot ref.
    if (!this.snapshot) {
      return {
        isWorking: false,
        isBusy: false,
        hasPendingPermission: false,
        canSubmit: false,
        canCancel: false,
      };
    }
    return {
      isWorking: this._machine.isWorking,
      isBusy: this._machine.isBusy,
      hasPendingPermission: this._machine.hasPendingPermission,
      canSubmit: this._machine.canSubmit,
      canCancel: this._machine.canCancel,
    };
  }

  // ── Public actions ──────────────────────────────────────────────────────────

  /**
   * Apply a session snapshot received from IPC (or from bootstrap).
   * Updates both the machine mirror and the observable snapshot ref.
   */
  applySnapshot(s: SessionSnapshot): void {
    this._machine.applySnapshot(s);
    this.snapshot = s;
    if (s.lifecycle === 'closed') {
      this.chatState.transcript.activeTurn.commit('done');
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to ACP events and trigger hydrateConversation to start the
   * session, then fetch initial history / state. Safe to call only once.
   */
  bootstrap(): void {
    if (this._bootstrapped) return;
    this._bootstrapped = true;

    // Subscribe first so we don't miss events that arrive during the RPC round-trip.
    this._subscribeEvents();

    // Hydrate the conversation (starts the ACP session if not already running).
    void rpc.conversations
      .hydrateConversation(this.projectId, this.taskId, this.conversationId)
      .then(() => this._fetchInitialState())
      .catch((err: unknown) => {
        console.error('[AcpChatStore] bootstrap error', err);
      });
  }

  /**
   * Bind or unbind the active ChatView handle. Called by AcpChatPanel when the
   * active store changes (bind on switch-to, unbind on switch-away). Only the
   * currently-visible conversation holds a view handle so imperative scroll
   * calls (scrollToItem on submit) target the right view.
   */
  bindView(view: ChatView | null): void {
    this._view = view;
  }

  /** Send a new user prompt to the ACP session. */
  submitPrompt(text: string, images?: AcpPromptImage[]): void {
    // 1. Optimistic user message: insert immediately so the scroll can happen
    //    before the IPC echo arrives. The server echo in _replayActiveUpdates
    //    replaces this row and re-points the pinTop intent to the real id.
    const optimisticId = `optimistic:user:${Date.now()}`;
    this._optimisticUserId = optimisticId;
    const optimistic: ChatMessage = {
      kind: 'message',
      id: optimisticId,
      role: 'user',
      text,
      attachments: images?.map(toChatImageAttachment),
    };
    this.chatState.transcript.activeTurn.set([optimistic], 'generating');
    runInAction(() => this._syncMessageCount());

    // 2. Immediately pin the new user message to the top of the viewport.
    //    activeTurnReserve() in ChatRoot ensures there is enough canvas space
    //    for the scroll target to be reachable even before any agent reply.
    const pinMode: ScrollMode = { kind: 'pinTop', itemId: optimisticId };
    this._view?.setScrollMode(pinMode);
    // Persist intent in ChatState so it survives a tab-switch during the request.
    this.chatState.scroll.set(pinMode);

    void rpc.acp.prompt(this.conversationId, text, images).catch((err: unknown) => {
      console.error('[AcpChatStore] prompt error', err);
    });
  }

  /** Cancel the currently running turn. */
  stop(): void {
    void rpc.acp.cancel(this.conversationId).catch((err: unknown) => {
      console.error('[AcpChatStore] cancel error', err);
    });
  }

  /** Switch the active model. */
  setModel(modelId: string): void {
    void rpc.acp.setModel(this.conversationId, modelId).catch((err: unknown) => {
      console.error('[AcpChatStore] setModel error', err);
    });
  }

  /** Resolve the front-of-queue permission request. */
  resolvePermission(optionId: string | null): void {
    const request = this.permissionQueue[0];
    if (!request) return;
    void rpc.acp
      .resolvePermission(this.conversationId, request.requestId, optionId)
      .catch((err: unknown) => {
        console.error('[AcpChatStore] resolvePermission error', err);
      });
  }

  /** Clean up event subscriptions and dispose the per-conversation Solid state. */
  dispose(): void {
    for (const unsub of this._unsubs) unsub();
    this._unsubs.length = 0;
    // chatState is per-conversation and must be disposed; chatContext is the
    // shared app-wide singleton and must NOT be disposed here.
    this.chatState.dispose();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _subscribeEvents(): void {
    this._unsubs.push(
      events.on(acpSessionUpdateChannel, (e) => {
        if (e.conversationId !== this.conversationId) return;
        this._handleSessionUpdate(e.seq, e.update);
      }),

      events.on(acpTurnCommittedChannel, (e) => {
        if (e.conversationId !== this.conversationId) return;
        this._handleTurnCommitted(e.turn);
      }),

      events.on(acpSessionStateChannel, (e) => {
        if (e.conversationId !== this.conversationId) return;
        runInAction(() => {
          this.applySnapshot(e.snapshot);
          this._activeTurnId = e.snapshot.activeTurnId;
        });
      }),

      events.on(acpSessionClosedChannel, (e) => {
        if (e.conversationId !== this.conversationId) return;
        runInAction(() => {
          if (this.snapshot) {
            this.applySnapshot({ ...this.snapshot, lifecycle: 'closed', activeTurnId: null });
          }
        });
      }),

      // ── Terminal events ──────────────────────────────────────────────────
      events.on(acpTerminalCreatedChannel, (e) => {
        if (e.conversationId !== this.conversationId) return;
        runInAction(() => {
          this.terminals.push({
            terminalId: e.terminalId,
            command: e.command,
            args: e.args,
            cwd: e.cwd,
            output: '',
            truncated: false,
            exitStatus: null,
          });
        });
      }),

      events.on(acpTerminalOutputChannel, (e) => {
        if (e.conversationId !== this.conversationId) return;
        runInAction(() => {
          const t = this.terminals.find((t) => t.terminalId === e.terminalId);
          if (t) {
            t.output += e.chunk;
            t.truncated = e.truncated;
          }
        });
      }),

      events.on(acpTerminalExitChannel, (e) => {
        if (e.conversationId !== this.conversationId) return;
        runInAction(() => {
          const t = this.terminals.find((t) => t.terminalId === e.terminalId);
          if (t) t.exitStatus = e.exitStatus;
        });
      }),

      events.on(acpTerminalReleasedChannel, (e) => {
        if (e.conversationId !== this.conversationId) return;
        runInAction(() => {
          const idx = this.terminals.findIndex((t) => t.terminalId === e.terminalId);
          if (idx >= 0) this.terminals.splice(idx, 1);
        });
      })
    );
  }

  private async _fetchInitialState(): Promise<void> {
    try {
      const [history, state, terminals] = await Promise.all([
        rpc.acp.getChatHistory(this.conversationId),
        rpc.acp.getSessionState(this.conversationId),
        rpc.acp.getTerminals(this.conversationId),
      ]);

      const historyItems = foldHistory(history);

      runInAction(() => {
        this.applySnapshot(toSessionSnapshot(state));
        this._activeTurnId = state.activeTurn?.id ?? null;
        this.terminals = terminals;

        // Seed in-flight active turn updates from the server state.
        if (state.activeTurn) {
          for (const entry of state.activeTurn.updates) {
            if (!this._activeTurnUpdates.has(entry.seq)) {
              this._activeTurnUpdates.set(entry.seq, entry);
            }
          }
        }
      });

      // Seed history then replay any buffered active-turn updates.
      // Each transcript method already batches its own signal writes internally.
      this.chatState.transcript.history.seed(historyItems);
      this._replayActiveUpdates();
      runInAction(() => {
        this.historyLoading = false;
        this._syncMessageCount();
      });
    } catch (err) {
      console.error('[AcpChatStore] _fetchInitialState error', err);
      runInAction(() => {
        this.historyLoading = false;
      });
    }
  }

  /**
   * Extracts the currently selected model from an array of config options.
   * The model option is identified by `category === 'model'` and must be a
   * select-type option (type === 'select') where currentValue is a string.
   */
  private _extractModel(
    configOptions: ReadonlyArray<{
      id: string;
      category?: string | null;
      type?: string;
      currentValue?: string | boolean;
    }>
  ): string | null {
    const modelOption = configOptions.find((o) => o.category === 'model' && o.type === 'select');
    if (modelOption && typeof modelOption.currentValue === 'string') {
      return modelOption.currentValue;
    }
    return null;
  }

  private _handleSessionUpdate(seq: number, update: AgentUpdate): void {
    this._activeTurnUpdates.set(seq, { seq, update });
    this._replayActiveUpdates();
  }

  private _replayActiveUpdates(): void {
    if (this._activeTurnUpdates.size === 0) return;

    const sorted = Array.from(this._activeTurnUpdates.values()).sort((a, b) => a.seq - b.seq);

    // Use the known active turn id so that item ids produced here match those
    // that foldTurn will produce when the turn commits, avoiding row churn on
    // the stream→commit transition. Fall back to 'active' only in the brief
    // window before the first session-state arrives.
    const turnId = this._activeTurnId ?? 'active';

    let items: ChatItem[] = [];
    for (const { update } of sorted) {
      const evts = mapAgentUpdate(update, turnId);
      for (const evt of evts) {
        items = applyTurnEvent(items, evt);
      }
    }

    this.chatState.transcript.activeTurn.set(items, 'generating');
    // Re-point pinTop from the optimistic id to the real server id now that
    // the echo has arrived. The row content is stable from here on.
    if (this._optimisticUserId) {
      const realId = this._lastUserMessageId();
      if (realId) {
        const pinMode: ScrollMode = { kind: 'pinTop', itemId: realId };
        this._view?.setScrollMode(pinMode);
        this.chatState.scroll.set(pinMode);
        this._optimisticUserId = null;
      }
    }
    runInAction(() => {
      this._syncMessageCount();
    });
  }

  private _handleTurnCommitted(turn: AcpTurn): void {
    const items = foldTurn(turn);
    this._activeTurnUpdates.clear();

    // Replace the activeTurn snapshot with the finalized version and commit.
    this.chatState.transcript.activeTurn.set(items, 'generating');
    this.chatState.transcript.activeTurn.commit('done');

    // If a pinTop is still active (shouldn't normally happen; guard only),
    // revert to bottom now that the turn is done.
    if (this._optimisticUserId) {
      this._optimisticUserId = null;
      const m: ScrollMode = { kind: 'bottom' };
      this._view?.setScrollMode(m);
      this.chatState.scroll.set(m);
    }
    runInAction(() => {
      this._activeTurnId = null;
      this._syncMessageCount();
    });
  }

  /** Sync messageCount from the transcript. Must be called inside runInAction. */
  private _syncMessageCount(): void {
    const state = this.chatState.transcript.state;
    this.messageCount = state.committed.length + (state.activeTurn?.length ?? 0);
  }

  /**
   * Return the id of the last user-role message in the active turn, falling
   * back to the last committed item if no active turn exists.
   */
  private _lastUserMessageId(): string | null {
    const state = this.chatState.transcript.state;
    const activeTurn = state.activeTurn;
    const source: readonly ChatItem[] =
      activeTurn && activeTurn.length > 0 ? activeTurn : state.committed;

    for (let i = source.length - 1; i >= 0; i--) {
      const item = source[i];
      if (item && item.kind === 'message' && (item as { role?: string }).role === 'user') {
        return item.id;
      }
    }
    return null;
  }
}

// ── Module helpers ─────────────────────────────────────────────────────────────

/**
 * Map an AcpPromptImage (base64 data + mimeType) to the ChatImageAttachment
 * shape expected by @emdash/chat-ui's ChatMessage.attachments. The data URL is
 * formed from the mimeType and base64 payload so the transcript can render a
 * thumbnail inline without a round-trip to the main process.
 */
function toChatImageAttachment(img: AcpPromptImage): ChatImageAttachment {
  return {
    id: img.name ?? `img-${Date.now()}`,
    name: img.name ?? 'image',
    dataUrl: `data:${img.mimeType};base64,${img.data}`,
  };
}
