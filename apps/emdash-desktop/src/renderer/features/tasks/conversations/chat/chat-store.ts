import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { ChatItem as UiChatItem, TranscriptApi } from '@emdash/chat-ui';
import { action, makeObservable, observable } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import {
  acpSessionClosedChannel,
  acpSessionReplayChannel,
  acpSessionStatusChannel,
  acpSessionUpdateChannel,
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

/** A tool call line, positioned chronologically within the transcript. */
export type ChatToolItem = {
  kind: 'tool';
  id: string;
  toolCallId: string;
  toolName: string;
  status: ToolStatusKind;
  inputSummary?: string;
};

/** A single ordered entry in the chat transcript. */
export type ChatItem = ChatMessageItem | ChatToolItem;

/** Convert desktop ChatItem[] to chat-ui ChatItem[] for TranscriptApi.seed(). */
function toChatUiItems(items: ChatItem[]): UiChatItem[] {
  return items.flatMap((item): UiChatItem[] => {
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
    if (item.role === 'thought') {
      return [
        {
          kind: 'thinking',
          id: item.id,
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

  /** Bound chat-ui transcript — set when the ChatTranscript component mounts. */
  private _transcript: TranscriptApi | null = null;

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

    this._unsubs.push(
      events.on(
        acpSessionUpdateChannel,
        action((payload) => {
          if (payload.conversationId !== this._conversationId) return;
          this._applyUpdate(payload.update);
        })
      )
    );

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

    // Reset transcript before a loadSession replay and finalize streaming once
    // all replayed chunks have arrived.
    this._unsubs.push(
      events.on(
        acpSessionReplayChannel,
        action((payload) => {
          if (payload.conversationId !== this._conversationId) return;
          if (payload.phase === 'start') {
            this.items = [];
            this._streamKeyMap.clear();
            this.isClosed = false;
            this._transcript?.reset();
          } else {
            this._finalizeStreaming();
          }
        })
      )
    );

    // Track ACP session readiness so the composer can gate Send and the panel
    // can show a loading state while the agent cold-starts or replays history.
    this._unsubs.push(
      events.on(
        acpSessionStatusChannel,
        action((payload) => {
          if (payload.conversationId !== this._conversationId) return;
          if (payload.status === 'ready') this.isReady = true;
          else if (payload.status === 'starting') this.isReady = false;
        })
      )
    );

    // Bootstrap in case the status event fired before this store was created
    // (e.g. keepAlive pool: tab was already hydrated when ChatStore is lazily
    // constructed). Only upgrade: never clobber a 'ready' that arrived first.
    void rpc.acp.getSessionStatus(this._conversationId).then(
      action((status) => {
        if (status === 'ready' && !this.isReady) this.isReady = true;
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
          this.isWorking = false;
          this._finalizeStreaming();
        })
      )
      .catch(
        action(() => {
          this.isWorking = false;
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
  }

  private _applyUpdate(update: SessionUpdate): void {
    const kind = update.sessionUpdate;
    log.debug('ChatStore: _applyUpdate [TEMP]', {
      conversationId: this._conversationId,
      kind,
      itemsBeforeUpdate: this.items.length,
      transcriptBound: this._transcript !== null,
    });

    if (kind === 'agent_message_chunk') {
      this._appendChunk('assistant', update);
    } else if (kind === 'agent_thought_chunk') {
      this._appendThinkingChunk(update);
    } else if (kind === 'user_message_chunk') {
      this._appendChunk('user', update);
    } else if (kind === 'tool_call') {
      this._upsertTool({
        toolCallId: update.toolCallId,
        toolName: update.title,
        status: 'running',
        inputSummary: this._summarizeInput(update.rawInput),
      });
    } else if (kind === 'tool_call_update') {
      if (update.status === 'completed') {
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
    const text =
      chunk.content.type === 'text' ? ((chunk.content as { text?: string }).text ?? '') : '';
    const messageId = chunk.messageId ?? undefined;

    // Merge by role + messageId so chunks of the same message coalesce while a
    // thought and an assistant message sharing a messageId stay distinct bubbles.
    if (messageId) {
      const streamKey = `${role}:${messageId}`;
      const existing = this._streamKeyMap.get(streamKey);
      if (existing) {
        existing.text += text;
      } else {
        const created = this._pushMessage(role, text);
        this._streamKeyMap.set(streamKey, created);
      }
      this._transcript?.dispatch({ type: 'message_chunk', role, id: messageId, text });
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

  private _appendThinkingChunk(
    chunk: { messageId?: string | null; content: { type: string; text?: string } }
  ): void {
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

  private _pushMessage(
    role: ChatMessageRole,
    text: string,
    streaming = true
  ): ChatMessageItem {
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

  /** Marks all streaming message bubbles as settled and commits the active turn. */
  private _finalizeStreaming(): void {
    for (const item of this.items) {
      if (item.kind === 'message') item.streaming = false;
    }
    this._streamKeyMap.clear();
    this._transcript?.dispatch({ type: 'turn_done' });
  }

  private _summarizeInput(input: unknown): string | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const keys = Object.keys(input as Record<string, unknown>);
    if (keys.length === 0) return undefined;
    return keys.slice(0, 3).join(', ');
  }
}
