import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type {
  ChatDiff,
  ChatExecute,
  ChatFileOpToolCall,
  ChatItem as UiChatItem,
  ChatResourceLink,
  FileOpKind,
  ResourceTarget,
  ToolStatus,
  TranscriptApi,
} from '@emdash/chat-ui';
import { action, makeObservable, observable } from 'mobx';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import {
  createWorkspaceFileResolver,
  type WorkspaceFileResolver,
} from '@renderer/features/tasks/stores/workspace-file-resolver';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import {
  acpSessionClosedChannel,
  acpSessionStateChannel,
  acpSessionUpdateChannel,
  acpTurnCommittedChannel,
} from '@shared/core/acp/acpEvents';

export type ChatMessageRole = 'user' | 'assistant' | 'thought';

export type ToolStatusKind = 'running' | 'done' | 'error';

/** A rendered message bubble (user / assistant / thought). */
export type ChatMessageItem = {
  kind: 'message';
  id: string;
  role: ChatMessageRole;
  text: string;
  streaming: boolean;
};

/** A generic tool call line. */
export type ChatToolItem = {
  kind: 'tool';
  id: string;
  toolCallId: string;
  toolName: string;
  status: ToolStatusKind;
  inputSummary?: string;
};

/** A file-operation tool call line (read / edit / delete / move). */
export type ChatFileOpItem = {
  kind: 'file-op';
  id: string;
  op: FileOpKind;
  status: ToolStatusKind;
  ops: { path: string }[];
};

/** An execute tool call line (shell commands). */
export type ChatExecuteItem = {
  kind: 'execute';
  id: string;
  command: string;
  status: ToolStatusKind;
  startedAt: number;
  durationMs?: number;
};

/** A diff preview row — one per changed file in an ACP edit tool call. */
export type ChatDiffItem = {
  kind: 'diff';
  /** `${toolCallId}:${path}` */
  id: string;
  path: string;
  oldText: string | null;
  newText: string;
  status: ToolStatusKind;
};

/**
 * A resource-link row — produced by ACP `resource_link` content blocks.
 * The `target` starts as provisional and is patched async by the resolver.
 */
export type ChatResourceLinkItem = {
  kind: 'resource-link';
  id: string;
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  target: ResourceTarget;
  status: ToolStatusKind;
};

/** A single ordered entry in the chat transcript. */
export type ChatItem =
  | ChatMessageItem
  | ChatToolItem
  | ChatFileOpItem
  | ChatExecuteItem
  | ChatDiffItem
  | ChatResourceLinkItem;

/** Convert desktop ChatItem[] to chat-ui ChatItem[] for TranscriptApi.seed(). */
function toChatUiItems(items: ChatItem[]): UiChatItem[] {
  return items.flatMap((item): UiChatItem[] => {
    if (item.kind === 'resource-link') {
      return [
        {
          kind: 'resource-link',
          id: item.id,
          uri: item.uri,
          name: item.name,
          title: item.title,
          description: item.description,
          mimeType: item.mimeType,
          size: item.size,
          target: item.target,
          status: item.status,
        } satisfies ChatResourceLink,
      ];
    }
    if (item.kind === 'tool') {
      return [
        {
          kind: 'tool',
          id: item.toolCallId,
          name: item.toolName,
          status: item.status,
          inputSummary: item.inputSummary,
        },
      ];
    }
    if (item.kind === 'file-op') {
      return [
        {
          kind: 'file-op',
          id: item.id,
          op: item.op,
          status: item.status,
          ops: item.ops,
        } satisfies ChatFileOpToolCall,
      ];
    }
    if (item.kind === 'execute') {
      return [
        {
          kind: 'execute',
          id: item.id,
          command: item.command,
          status: item.status,
          startedAt: item.startedAt,
          durationMs: item.durationMs,
        } satisfies ChatExecute,
      ];
    }
    if (item.kind === 'diff') {
      return [
        {
          kind: 'diff',
          id: item.id,
          path: item.path,
          oldText: item.oldText,
          newText: item.newText,
          status: item.status,
        } satisfies ChatDiff,
      ];
    }
    if (item.role === 'thought') {
      return [
        {
          kind: 'thinking',
          id: item.id,
          // Committed history turns always have finalized thought rows.
          status: 'done',
          text: item.text,
          startedAt: 0,
        },
      ];
    }
    return [
      {
        kind: 'message',
        id: item.id,
        role: item.role,
        text: item.text,
        streaming: item.streaming,
      },
    ];
  });
}

const FILE_OP_KINDS = new Set<string>(['read', 'delete', 'move']);

/**
 * Extract unique file paths from an ACP tool call notification.
 * Prefers locations[]; falls back to diff content[] paths for edit calls.
 */
function extractPaths(
  update: Extract<SessionUpdate, { sessionUpdate: 'tool_call' }>
): { path: string }[] {
  const paths = new Set<string>();

  if (update.locations) {
    for (const loc of update.locations) {
      if (loc.path) paths.add(loc.path);
    }
  }

  if (paths.size === 0 && update.content) {
    for (const c of update.content) {
      if (c.type === 'diff' && c.path) paths.add(c.path);
    }
  }

  return Array.from(paths, (path) => ({ path }));
}

export class ChatStore {
  /**
   * Ordered transcript kept as source-of-truth for hydrating the chat-ui
   * TranscriptApi when it binds after mount (via bindTranscript).
   */
  items: ChatItem[] = [];
  isWorking = false;
  isClosed = false;
  /** True once the ACP session is ready to accept prompts. */
  isReady = false;
  input = '';
  selectedModel = 'default';

  private readonly _conversationId: string;
  private readonly _projectId: string;
  private readonly _taskId: string;
  private readonly _unsubs: (() => void)[] = [];

  /**
   * Maps a streaming message key (`${role}:${messageId}`) to its item, so chunks
   * for the same role+message merge while different roles stay separate bubbles.
   */
  private _streamKeyMap = new Map<string, ChatMessageItem>();

  /**
   * Counts how many resource_link blocks have been seen per message+role stream
   * (`${role}:${messageId}`). Incremented on each resource_link; used to build
   * a new stream key for text following a link, so post-link text starts a new
   * message segment instead of merging into the pre-link bubble.
   */
  private _segmentCountMap = new Map<string, number>();

  /** Lazily initialized per-session file resolver; null until first resource_link. */
  private _resolver: WorkspaceFileResolver | null = null;

  /** Bound chat-ui transcript — set when the ChatTranscript component mounts. */
  private _transcript: TranscriptApi | null = null;

  /**
   * False while the initial getChatHistory/getSessionState fetch is in-flight.
   * Live updates that arrive during this window are held in _pendingLive.
   */
  private _historyLoaded = false;
  private _pendingLive: { turnId: string; seq: number; update: SessionUpdate }[] = [];

  /**
   * Last sequence number applied from either the history buffer or the live
   * stream.  Used to dedup live updates that race the initial query.
   */
  private _lastSeq = -1;

  constructor(conversationId: string, projectId: string, taskId: string, initialModel?: string) {
    this._conversationId = conversationId;
    this._projectId = projectId;
    this._taskId = taskId;
    if (initialModel) this.selectedModel = initialModel;

    makeObservable(this, {
      items: observable,
      isWorking: observable,
      isClosed: observable,
      isReady: observable,
      input: observable,
      selectedModel: observable,
      setInput: action,
      sendPrompt: action,
      cancel: action,
      setModel: action,
    });

    // Live update deltas — only the active turn streams.
    this._unsubs.push(
      events.on(
        acpSessionUpdateChannel,
        action((payload) => {
          if (payload.conversationId !== this._conversationId) return;
          if (!this._historyLoaded) {
            // Hold updates that race in while the initial query is in-flight.
            this._pendingLive.push({
              turnId: payload.turnId,
              seq: payload.seq,
              update: payload.update,
            });
          } else if (payload.seq > this._lastSeq) {
            this._applyUpdate(payload.update);
            this._lastSeq = payload.seq;
          }
        })
      )
    );

    // Session lifecycle transitions (ready/working/closed).
    this._unsubs.push(
      events.on(
        acpSessionStateChannel,
        action((payload) => {
          if (payload.conversationId !== this._conversationId) return;
          this.isReady = payload.lifecycle === 'ready' || payload.lifecycle === 'working';
          this.isWorking = payload.lifecycle === 'working';
          this.isClosed = payload.lifecycle === 'closed';
        })
      )
    );

    // Active turn committed — finalize streaming items and dispatch turn_done.
    this._unsubs.push(
      events.on(
        acpTurnCommittedChannel,
        action((payload) => {
          if (payload.conversationId !== this._conversationId) return;
          this._finalizeStreaming();
        })
      )
    );

    // Session closed — also finalise any open streaming state.
    this._unsubs.push(
      events.on(
        acpSessionClosedChannel,
        action((payload) => {
          if (payload.conversationId !== this._conversationId) return;
          this.isWorking = false;
          this.isClosed = true;
          this._finalizeStreaming();
        })
      )
    );

    // Bootstrap: pull history (committed turns) and current session state.
    // History turns are known-complete so each one is finalized deterministically,
    // fixing the stuck-thinking race that existed in the old event-stream model.
    void Promise.all([
      rpc.acp.getSessionState(this._conversationId),
      rpc.acp.getChatHistory(this._conversationId),
    ])
      .then(
        action(([state, history]) => {
          // 1. Committed history: reduce each turn then finalize.
          for (const turn of history.turns) {
            for (const { seq, update } of turn.updates) {
              this._applyUpdate(update);
              this._lastSeq = Math.max(this._lastSeq, seq);
            }
            // Each committed turn is known-complete: finalize unconditionally.
            this._finalizeStreaming();
          }

          // 2. Active turn (mid-flight on reload): reduce without finalizing.
          if (state.activeTurn) {
            for (const { seq, update } of state.activeTurn.updates) {
              this._applyUpdate(update);
              this._lastSeq = Math.max(this._lastSeq, seq);
            }
          }

          // 3. Sync lifecycle state.
          this.isWorking = state.lifecycle === 'working';
          this.isReady = state.lifecycle === 'ready' || state.lifecycle === 'working';
          this.isClosed = state.lifecycle === 'closed';
          if (state.model && state.model !== 'default') {
            this.selectedModel = state.model;
          }
        })
      )
      .catch((err) => {
        log.warn('ChatStore: initial query failed', {
          conversationId: this._conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .finally(
        action(() => {
          // Flush live updates that raced the async query (seq-guarded).
          for (const { seq, update } of this._pendingLive) {
            if (seq > this._lastSeq) {
              this._applyUpdate(update);
              this._lastSeq = seq;
            }
          }
          this._pendingLive = [];
          this._historyLoaded = true;
        })
      );
  }

  get hasItems(): boolean {
    return this.items.length > 0;
  }

  /**
   * Called by ChatPanel via onReady once the chat-ui ChatTranscript mounts.
   * Seeds the transcript with any items already accumulated before mount.
   */
  bindTranscript(api: TranscriptApi): void {
    this._transcript = api;
    if (this.items.length > 0) {
      api.seed(toChatUiItems(this.items));
    }
  }

  setInput(value: string): void {
    this.input = value;
  }

  sendPrompt(): void {
    const text = this.input.trim();
    if (!text || this.isWorking) return;
    this.input = '';
    this.isWorking = true;

    // Optimistically add user message
    const userId = `user-${Date.now()}`;
    this.items.push({
      kind: 'message',
      id: userId,
      role: 'user',
      text,
      streaming: false,
    });
    this._transcript?.dispatch({ type: 'message_chunk', role: 'user', id: userId, text });
    this._transcript?.dispatch({ type: 'turn_done' });

    void rpc.acp
      .prompt(this._conversationId, text)
      .then(
        action(() => {
          // isWorking is now driven by acpSessionStateChannel; this is just a fallback
          // in case the state event hasn't arrived yet.
          if (this.isWorking) this.isWorking = false;
        })
      )
      .catch(
        action(() => {
          if (this.isWorking) this.isWorking = false;
          this._finalizeStreaming();
        })
      );
  }

  cancel(): void {
    void rpc.acp.cancel(this._conversationId);
  }

  setModel(modelId: string): void {
    this.selectedModel = modelId;
    void rpc.acp.setModel(this._conversationId, modelId);
  }

  dispose(): void {
    for (const unsub of this._unsubs) unsub();
    this._resolver?.clear();
    this._resolver = null;
  }

  private _applyUpdate(update: SessionUpdate): void {
    const kind = update.sessionUpdate;

    if (kind === 'agent_message_chunk') {
      this._appendChunk('assistant', update);
    } else if (kind === 'agent_thought_chunk') {
      this._appendThinkingChunk(update);
    } else if (kind === 'user_message_chunk') {
      this._appendChunk('user', update);
    } else if (kind === 'tool_call') {
      const acpKind = update.kind ?? undefined;
      if (acpKind && FILE_OP_KINDS.has(acpKind)) {
        this._upsertFileOp({
          id: update.toolCallId,
          op: acpKind as FileOpKind,
          status: 'running',
          ops: extractPaths(update),
        });
      } else if (acpKind === 'edit') {
        this._upsertDiffsFromUpdate(update);
      } else if (acpKind === 'execute') {
        const rawInput = update.rawInput as Record<string, unknown> | null | undefined;
        this._upsertExecute({
          id: update.toolCallId,
          command: typeof rawInput?.command === 'string' ? rawInput.command : '',
        });
      } else {
        this._upsertTool({
          toolCallId: update.toolCallId,
          toolName: update.title,
          status: 'running',
          inputSummary: this._summarizeInput(update.rawInput),
        });
      }
    } else if (kind === 'tool_call_update') {
      const existingFileOp = this.items.find(
        (it): it is ChatFileOpItem => it.kind === 'file-op' && it.id === update.toolCallId
      );
      const existingExecute = this.items.find(
        (it): it is ChatExecuteItem => it.kind === 'execute' && it.id === update.toolCallId
      );
      const existingDiffs = this.items.filter(
        (it): it is ChatDiffItem => it.kind === 'diff' && it.id.startsWith(`${update.toolCallId}:`)
      );
      if (existingFileOp) {
        const newOps = update.locations
          ? update.locations
              .filter((l): l is { path: string } => typeof l.path === 'string')
              .map((l) => ({ path: l.path }))
          : undefined;
        const newStatus =
          update.status === 'completed' ? 'done' : update.status === 'failed' ? 'error' : undefined;
        this._upsertFileOp({ id: update.toolCallId, status: newStatus, ops: newOps });
      } else if (existingExecute) {
        const rawInput = update.rawInput as Record<string, unknown> | null | undefined;
        const newCommand = typeof rawInput?.command === 'string' ? rawInput.command : undefined;
        const newStatus =
          update.status === 'completed' ? 'done' : update.status === 'failed' ? 'error' : undefined;
        this._upsertExecute({
          id: update.toolCallId,
          command: newCommand,
          status: newStatus,
        });
      } else if (existingDiffs.length > 0) {
        const newStatus: ToolStatus | undefined =
          update.status === 'completed' ? 'done' : update.status === 'failed' ? 'error' : undefined;
        if (update.content) {
          // Re-apply content diffs (updated oldText/newText) and status
          this._upsertDiffsFromUpdate(update, newStatus);
        } else if (newStatus) {
          for (const d of existingDiffs) {
            this._upsertDiff({ id: d.id, path: d.path, status: newStatus });
          }
        }
      } else if (update.status === 'completed') {
        this._upsertTool({ toolCallId: update.toolCallId, status: 'done' });
      } else if (update.status === 'failed') {
        this._upsertTool({ toolCallId: update.toolCallId, status: 'error' });
      }
    }
  }

  private _appendChunk(
    role: 'user' | 'assistant',
    chunk: { messageId?: string | null; content: { type: string; text?: string } }
  ): void {
    // Intercept resource_link content blocks — emit a standalone row and bump the
    // segment counter so subsequent text for the same messageId starts a new bubble.
    if (chunk.content.type === 'resource_link') {
      const messageId = chunk.messageId ?? undefined;
      const rc = chunk.content as {
        uri?: string;
        name?: string;
        title?: string;
        description?: string;
        mimeType?: string;
        size?: number;
      };
      this._appendResourceLink(role, messageId, rc);
      return;
    }

    const text =
      chunk.content.type === 'text' ? ((chunk.content as { text?: string }).text ?? '') : '';
    const messageId = chunk.messageId ?? undefined;

    // Merge by role + messageId so chunks of the same message coalesce while a
    // thought and an assistant message sharing a messageId stay distinct bubbles.
    // After a resource_link split, the segment counter is > 0 and the stream key
    // is suffixed so a new bubble is created for post-link text.
    if (messageId) {
      const baseKey = `${role}:${messageId}`;
      const segCount = this._segmentCountMap.get(baseKey) ?? 0;
      const streamKey = segCount > 0 ? `${baseKey}:${segCount}` : baseKey;
      const existing = this._streamKeyMap.get(streamKey);
      if (existing) {
        existing.text += text;
        this._transcript?.dispatch({ type: 'message_chunk', role, id: existing.id, text });
      } else {
        const created = this._pushMessage(role, text);
        this._streamKeyMap.set(streamKey, created);
        // Use the generated item id for the transcript, not the ACP messageId,
        // because split segments within the same ACP message need distinct ids.
        this._transcript?.dispatch({ type: 'message_chunk', role, id: created.id, text });
      }
      return;
    }

    // No messageId: append to the trailing bubble if it's the same role and still
    // streaming; otherwise start a new bubble.
    const last = this.items.at(-1);
    if (last && last.kind === 'message' && last.role === role && last.streaming) {
      last.text += text;
      this._transcript?.dispatch({ type: 'message_chunk', role, id: last.id, text });
      return;
    }
    const created = this._pushMessage(role, text);
    this._transcript?.dispatch({ type: 'message_chunk', role, id: created.id, text });
  }

  private _appendResourceLink(
    role: 'user' | 'assistant',
    messageId: string | undefined,
    content: {
      uri?: string;
      name?: string;
      title?: string;
      description?: string;
      mimeType?: string;
      size?: number;
    }
  ): void {
    const uri = content.uri ?? '';
    const name = content.name ?? uri;
    // Stable id based on the order of links within the message (or a timestamp fallback).
    const baseKey = messageId ? `${role}:${messageId}` : null;
    const segCount = baseKey ? (this._segmentCountMap.get(baseKey) ?? 0) : 0;
    const id = messageId ? `${messageId}:rl:${segCount}` : `rl-${Date.now()}-${Math.random()}`;

    // Bump segment counter so subsequent text for this messageId starts a new bubble.
    if (baseKey) {
      this._segmentCountMap.set(baseKey, segCount + 1);
    }

    // Provisional target — will be patched asynchronously by the resolver.
    const provisionalTarget: ResourceTarget = { kind: 'opaque' };

    const item: ChatResourceLinkItem = {
      kind: 'resource-link',
      id,
      uri,
      name,
      title: content.title,
      description: content.description,
      mimeType: content.mimeType,
      size: content.size,
      target: provisionalTarget,
      status: 'running',
    };
    this.items.push(item);

    this._transcript?.dispatch({
      type: 'resource_link_start',
      id,
      uri,
      name,
      title: content.title,
      description: content.description,
      mimeType: content.mimeType,
      size: content.size,
      target: provisionalTarget,
    });

    // Async resolve the target; patch when done (two-phase enrichment).
    const resolver = this.getResolver();
    if (resolver && uri) {
      void resolver.resolve(uri).then(
        action((resolved) => {
          item.target = resolved;
          this._transcript?.dispatch({
            type: 'resource_link_update',
            id,
            target: resolved,
          });
        })
      );
    }
  }

  private _appendThinkingChunk(chunk: {
    messageId?: string | null;
    content: { type: string; text?: string };
  }): void {
    const text =
      chunk.content.type === 'text' ? ((chunk.content as { text?: string }).text ?? '') : '';
    const thinkingId = chunk.messageId ?? `thought-${Date.now()}`;

    // Mirror into items[] as a legacy thought message for seed() hydration.
    const streamKey = `thought:${thinkingId}`;
    const existing = this._streamKeyMap.get(streamKey);
    if (existing) {
      existing.text += text;
    } else {
      const created = this._pushMessage('thought', text);
      this._streamKeyMap.set(streamKey, created);
    }

    // The transcript reducer owns startedAt and text accumulation — just dispatch the delta.
    this._transcript?.dispatch({ type: 'thinking_chunk', id: thinkingId, text });
  }

  private _pushMessage(role: ChatMessageRole, text: string, streaming = true): ChatMessageItem {
    const item: ChatMessageItem = {
      kind: 'message',
      id: `${role}-${Date.now()}-${Math.random()}`,
      role,
      text,
      streaming,
    };
    this.items.push(item);
    // Return the array-resident element: MobX wraps pushed plain objects in an
    // observable proxy, so mutating the original `item` would not be reactive.
    return this.items[this.items.length - 1] as ChatMessageItem;
  }

  /**
   * Returns the workspace file resolver for this session, creating it lazily on
   * first access. Returns null if the task is not yet provisioned.
   *
   * Used externally by the conversation-manager to implement `classifyLink`.
   */
  getResolver(): WorkspaceFileResolver | null {
    if (this._resolver) return this._resolver;
    const provisioned = asProvisioned(getTaskStore(this._projectId, this._taskId));
    if (!provisioned) return null;
    this._resolver = createWorkspaceFileResolver(this._projectId, provisioned.workspaceId);
    return this._resolver;
  }

  private _upsertTool(patch: {
    toolCallId: string;
    toolName?: string;
    status?: ToolStatusKind;
    inputSummary?: string;
  }): void {
    const existing = this.items.find(
      (it): it is ChatToolItem => it.kind === 'tool' && it.toolCallId === patch.toolCallId
    );
    if (existing) {
      if (patch.toolName !== undefined) existing.toolName = patch.toolName;
      if (patch.status !== undefined) existing.status = patch.status;
      if (patch.inputSummary !== undefined) existing.inputSummary = patch.inputSummary;
      this._transcript?.dispatch({
        type: 'tool_update',
        id: patch.toolCallId,
        status: patch.status,
        name: patch.toolName,
        inputSummary: patch.inputSummary,
      });
    } else {
      this.items.push({
        kind: 'tool',
        id: patch.toolCallId,
        toolCallId: patch.toolCallId,
        toolName: patch.toolName ?? '(tool)',
        status: patch.status ?? 'running',
        inputSummary: patch.inputSummary,
      });
      this._transcript?.dispatch({
        type: 'tool_start',
        id: patch.toolCallId,
        name: patch.toolName ?? '(tool)',
        inputSummary: patch.inputSummary,
      });
    }
  }

  private _upsertFileOp(patch: {
    id: string;
    op?: FileOpKind;
    status?: ToolStatusKind;
    ops?: { path: string }[];
  }): void {
    const existing = this.items.find(
      (it): it is ChatFileOpItem => it.kind === 'file-op' && it.id === patch.id
    );
    if (existing) {
      if (patch.status !== undefined) existing.status = patch.status;
      if (patch.ops !== undefined) existing.ops = patch.ops;
      this._transcript?.dispatch({
        type: 'file_op_update',
        id: patch.id,
        status: patch.status,
        ops: patch.ops,
      });
    } else {
      this.items.push({
        kind: 'file-op',
        id: patch.id,
        op: patch.op ?? 'read',
        status: patch.status ?? 'running',
        ops: patch.ops ?? [],
      });
      this._transcript?.dispatch({
        type: 'file_op_start',
        id: patch.id,
        op: patch.op ?? 'read',
        ops: patch.ops ?? [],
      });
    }
  }

  private _upsertExecute(patch: { id: string; command?: string; status?: ToolStatusKind }): void {
    const existing = this.items.find(
      (it): it is ChatExecuteItem => it.kind === 'execute' && it.id === patch.id
    );
    if (existing) {
      if (patch.command !== undefined) existing.command = patch.command;
      if (patch.status !== undefined) {
        existing.status = patch.status;
        if (patch.status === 'done' && existing.durationMs === undefined) {
          existing.durationMs = Date.now() - existing.startedAt;
        }
      }
      this._transcript?.dispatch({
        type: 'execute_update',
        id: patch.id,
        command: patch.command,
        status: patch.status,
      });
    } else {
      const startedAt = Date.now();
      this.items.push({
        kind: 'execute',
        id: patch.id,
        command: patch.command ?? '',
        status: patch.status ?? 'running',
        startedAt,
      });
      this._transcript?.dispatch({
        type: 'execute_start',
        id: patch.id,
        command: patch.command ?? '',
        startedAt,
      });
    }
  }

  /**
   * Parse diff content from an ACP `tool_call` (or `tool_call_update`) payload
   * and upsert one diff row per changed file.
   *
   * Groups by path and uses only the first diff block per path to avoid
   * duplicate rows. Ignores entries without valid path/newText.
   */
  private _upsertDiffsFromUpdate(
    update: {
      toolCallId: string;
      content?: { type: string; path?: string; newText?: string; oldText?: string | null }[] | null;
    },
    status?: ToolStatus
  ): void {
    if (!update.content) return;

    const seenPaths = new Set<string>();
    for (const entry of update.content) {
      if (entry.type !== 'diff') continue;
      const { path, newText, oldText: entryOldText } = entry;
      if (!path || !newText) continue;
      if (seenPaths.has(path)) continue;
      seenPaths.add(path);

      const oldText = entryOldText ?? null;
      const id = `${update.toolCallId}:${path}`;
      this._upsertDiff({ id, path, oldText, newText, status });
    }
  }

  private _upsertDiff(patch: {
    id: string;
    path: string;
    oldText?: string | null;
    newText?: string;
    status?: ToolStatus;
  }): void {
    const existing = this.items.find(
      (it): it is ChatDiffItem => it.kind === 'diff' && it.id === patch.id
    );
    if (existing) {
      if (patch.status !== undefined) existing.status = patch.status;
      if (patch.oldText !== undefined) existing.oldText = patch.oldText;
      if (patch.newText !== undefined) existing.newText = patch.newText;
      this._transcript?.dispatch({
        type: 'diff_update',
        id: patch.id,
        status: patch.status,
        oldText: patch.oldText,
        newText: patch.newText,
      });
    } else {
      this.items.push({
        kind: 'diff',
        id: patch.id,
        path: patch.path,
        oldText: patch.oldText ?? null,
        newText: patch.newText ?? '',
        status: patch.status ?? 'running',
      });
      this._transcript?.dispatch({
        type: 'diff_start',
        id: patch.id,
        path: patch.path,
        oldText: patch.oldText ?? null,
        newText: patch.newText ?? '',
      });
    }
  }

  /** Marks all streaming message bubbles as settled and commits the active turn. */
  private _finalizeStreaming(): void {
    for (const item of this.items) {
      if (item.kind === 'message') item.streaming = false;
    }
    this._streamKeyMap.clear();
    this._segmentCountMap.clear();
    this._transcript?.dispatch({ type: 'turn_done' });
    // Re-enrich resource links whose file existence may have changed mid-turn
    // (e.g., a file referenced at the start of the turn that was created later).
    void this._resolver?.reEnrichStale().then(() => {
      if (!this._transcript) return;
      for (const item of this.items) {
        if (item.kind === 'resource-link') {
          this._transcript?.dispatch({
            type: 'resource_link_update',
            id: item.id,
            target: item.target,
          });
        }
      }
    });
  }

  private _summarizeInput(input: unknown): string | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const keys = Object.keys(input as Record<string, unknown>);
    if (keys.length === 0) return undefined;
    return keys.slice(0, 3).join(', ');
  }
}
