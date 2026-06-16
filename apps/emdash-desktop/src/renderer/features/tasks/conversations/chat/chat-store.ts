import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { action, makeObservable, observable } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import {
  acpSessionClosedChannel,
  acpSessionReplayChannel,
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

export class ChatStore {
  /** Ordered transcript: messages and tool calls interleaved by arrival time. */
  items: ChatItem[] = [];
  isWorking = false;
  isClosed = false;
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

  constructor(conversationId: string, projectId: string, taskId: string, initialModel?: string) {
    this._conversationId = conversationId;
    this._projectId = projectId;
    this._taskId = taskId;
    if (initialModel) this.selectedModel = initialModel;

    makeObservable(this, {
      items: observable,
      isWorking: observable,
      isClosed: observable,
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
          } else {
            this._finalizeStreaming();
          }
        })
      )
    );
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
    this.items.push({
      kind: 'message',
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      streaming: false,
    });

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

    if (kind === 'agent_message_chunk') {
      this._appendChunk('assistant', update);
    } else if (kind === 'agent_thought_chunk') {
      this._appendChunk('thought', update);
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
    role: ChatMessageRole,
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
        return;
      }
      const created = this._pushMessage(role, text);
      this._streamKeyMap.set(streamKey, created);
      return;
    }

    // No messageId: append to the trailing bubble if it's the same role and still
    // streaming (i.e. nothing else interrupted it); otherwise start a new bubble.
    const last = this.items.at(-1);
    if (last && last.kind === 'message' && last.role === role && last.streaming) {
      last.text += text;
      return;
    }
    this._pushMessage(role, text);
  }

  private _pushMessage(role: ChatMessageRole, text: string): ChatMessageItem {
    const item: ChatMessageItem = {
      kind: 'message',
      id: `${role}-${Date.now()}-${Math.random()}`,
      role,
      text,
      streaming: true,
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
      return;
    }
    this.items.push({
      kind: 'tool',
      id: patch.toolCallId,
      toolCallId: patch.toolCallId,
      toolName: patch.toolName ?? '(tool)',
      status: patch.status ?? 'running',
      inputSummary: patch.inputSummary,
    });
  }

  /** Marks all streaming message bubbles as settled and resets the stream map. */
  private _finalizeStreaming(): void {
    for (const item of this.items) {
      if (item.kind === 'message') item.streaming = false;
    }
    this._streamKeyMap.clear();
  }

  private _summarizeInput(input: unknown): string | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const keys = Object.keys(input as Record<string, unknown>);
    if (keys.length === 0) return undefined;
    return keys.slice(0, 3).join(', ');
  }
}
