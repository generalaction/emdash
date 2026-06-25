/**
 * AcpChatStore — per-conversation MobX store that bridges ACP RPC/events to
 * the @emdash/chat-ui ChatHandle.
 *
 * Lifecycle:
 *   1. Construct with (conversationId, projectId, taskId).
 *   2. Call bootstrap() once — subscribes to IPC events, starts the ACP
 *      session via hydrateConversation, then seeds committed history.
 *   3. When the ChatTranscript mounts, call attachHandle(handle) — seeds
 *      history and sets any active turn if one is already in flight.
 *   4. Call dispose() when the tab closes to clean up subscriptions.
 */

import type { ChatHandle, ChatItem } from '@emdash/chat-ui';
import type { AcpPermissionRequest, AcpTurn, SessionLifecycle, TerminalSnapshot } from '@emdash/core/acp';
import {
  action,
  makeObservable,
  observable,
  runInAction,
} from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import {
  acpPermissionRequestChannel,
  acpPermissionResolvedChannel,
  acpSessionClosedChannel,
  acpSessionStateChannel,
  acpSessionUpdateChannel,
  acpTerminalCreatedChannel,
  acpTerminalExitChannel,
  acpTerminalOutputChannel,
  acpTerminalReleasedChannel,
  acpTurnCommittedChannel,
} from '@shared/core/acp/acpEvents';
import { applyTurnEvent } from '@emdash/chat-ui';
import { foldHistory, foldTurn, mapSessionUpdate } from './acp-update-mapper';

// ── Types ──────────────────────────────────────────────────────────────────────

export type AcpChatLifecycle = SessionLifecycle | 'idle';

// ── Store ──────────────────────────────────────────────────────────────────────

export class AcpChatStore {
  readonly conversationId: string;
  readonly projectId: string;
  readonly taskId: string;

  lifecycle: AcpChatLifecycle = 'idle';
  model: string | null = null;
  permissionQueue: AcpPermissionRequest[] = [];
  terminals: TerminalSnapshot[] = [];

  /** Buffered active-turn updates, keyed by seq, awaiting handle attachment. */
  private _activeTurnUpdates = new Map<number, { seq: number; update: SessionUpdate }>();
  /** The current active turn id (null when idle). */
  private _activeTurnId: string | null = null;

  /** Committed history seeded from RPC, held until the handle is ready. */
  private _pendingHistoryItems: ChatItem[] | null = null;

  private _handle: ChatHandle | null = null;
  private _bootstrapped = false;

  private readonly _unsubs: Array<() => void> = [];

  constructor(conversationId: string, projectId: string, taskId: string) {
    this.conversationId = conversationId;
    this.projectId = projectId;
    this.taskId = taskId;

    makeObservable(this, {
      lifecycle: observable,
      model: observable,
      permissionQueue: observable,
      terminals: observable,
      attachHandle: action,
      submitPrompt: action,
      stop: action,
      setModel: action,
      resolvePermission: action,
    });
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
   * Called by the ChatTranscript onReady callback. Seeds history and sets any
   * in-flight active turn so the UI catches up immediately.
   */
  attachHandle(handle: ChatHandle): void {
    this._handle = handle;

    // Seed committed history if we have it.
    if (this._pendingHistoryItems) {
      handle.transcript.history.seed(this._pendingHistoryItems);
      this._pendingHistoryItems = null;
    }

    // If there are buffered active-turn updates, replay them.
    this._replayActiveUpdates();
  }

  /** Send a new user prompt to the ACP session. */
  submitPrompt(text: string): void {
    void rpc.acp.prompt(this.conversationId, text).catch((err: unknown) => {
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
    runInAction(() => {
      this.model = modelId;
    });
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

  /** Clean up event subscriptions. The ChatHandle is disposed by React on unmount. */
  dispose(): void {
    for (const unsub of this._unsubs) unsub();
    this._unsubs.length = 0;
    this._handle = null;
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
          this.lifecycle = e.lifecycle;
          this._activeTurnId = e.activeTurnId;
        });
        if (e.lifecycle === 'closed') {
          this._handle?.transcript.activeTurn.commit('done');
        }
      }),

      events.on(acpSessionClosedChannel, (e) => {
        if (e.conversationId !== this.conversationId) return;
        runInAction(() => {
          this.lifecycle = 'closed';
        });
        this._handle?.transcript.activeTurn.commit('done');
      }),

      events.on(acpPermissionRequestChannel, (e) => {
        if (e.conversationId !== this.conversationId) return;
        runInAction(() => {
          this.permissionQueue.push(e);
        });
      }),

      events.on(acpPermissionResolvedChannel, (e) => {
        if (e.conversationId !== this.conversationId) return;
        runInAction(() => {
          const idx = this.permissionQueue.findIndex((r) => r.requestId === e.requestId);
          if (idx >= 0) this.permissionQueue.splice(idx, 1);
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
        this.lifecycle = state.lifecycle;
        this.model = state.model;
        this._activeTurnId = state.activeTurn?.id ?? null;
        this.terminals = terminals;

        // Rebuild permission queue from server state (avoids duplicates from events).
        this.permissionQueue = state.pendingPermissions.filter(
          (p) => !this.permissionQueue.some((q) => q.requestId === p.requestId)
        );

        // Seed in-flight active turn updates from the server state.
        if (state.activeTurn) {
          for (const entry of state.activeTurn.updates) {
            if (!this._activeTurnUpdates.has(entry.seq)) {
              this._activeTurnUpdates.set(entry.seq, entry);
            }
          }
        }
      });

      if (this._handle) {
        this._handle.transcript.history.seed(historyItems);
        this._replayActiveUpdates();
      } else {
        this._pendingHistoryItems = historyItems;
      }
    } catch (err) {
      console.error('[AcpChatStore] _fetchInitialState error', err);
    }
  }

  private _handleSessionUpdate(seq: number, update: SessionUpdate): void {
    this._activeTurnUpdates.set(seq, { seq, update });
    this._replayActiveUpdates();
  }

  private _replayActiveUpdates(): void {
    if (!this._handle) return;
    if (this._activeTurnUpdates.size === 0) return;

    const sorted = Array.from(this._activeTurnUpdates.values()).sort((a, b) => a.seq - b.seq);

    let items: ChatItem[] = [];
    for (const { update } of sorted) {
      const evts = mapSessionUpdate(update);
      for (const evt of evts) {
        items = applyTurnEvent(items, evt);
      }
    }

    this._handle.transcript.activeTurn.set(items, 'generating');
  }

  private _handleTurnCommitted(turn: AcpTurn): void {
    const items = foldTurn(turn);
    this._activeTurnUpdates.clear();

    if (this._handle) {
      // Replace the activeTurn snapshot with the finalized version and commit.
      this._handle.transcript.activeTurn.set(items, 'generating');
      this._handle.transcript.activeTurn.commit('done');
    }

    runInAction(() => {
      this._activeTurnId = null;
    });
  }
}
