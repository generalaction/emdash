import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { action, makeObservable, observable } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import { acpSessionClosedChannel, acpSessionUpdateChannel } from '@shared/core/acp/acpEvents';

export type ChatMessageRole = 'user' | 'assistant' | 'thought';

export type ToolStatus = {
  toolName: string;
  toolCallId: string;
  status: 'running' | 'done' | 'error';
  inputSummary?: string;
};

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  text: string;
  streaming: boolean;
};

export class ChatStore {
  messages: ChatMessage[] = [];
  toolStatuses: ToolStatus[] = [];
  isWorking = false;
  isClosed = false;
  input = '';

  private readonly _conversationId: string;
  private readonly _projectId: string;
  private readonly _taskId: string;
  private readonly _unsubs: (() => void)[] = [];

  /** Tracks which messageId maps to which messages[] index for streaming append. */
  private _messageIdMap = new Map<string, number>();

  constructor(conversationId: string, projectId: string, taskId: string) {
    this._conversationId = conversationId;
    this._projectId = projectId;
    this._taskId = taskId;

    makeObservable(this, {
      messages: observable,
      toolStatuses: observable,
      isWorking: observable,
      isClosed: observable,
      input: observable,
      setInput: action,
      sendPrompt: action,
      cancel: action,
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
    this.messages.push({
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
        })
      )
      .catch(
        action(() => {
          this.isWorking = false;
        })
      );
  }

  cancel(): void {
    void rpc.acp.cancel(this._conversationId);
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
      this._upsertToolStatus({
        toolCallId: update.toolCallId,
        toolName: update.title,
        status: 'running',
        inputSummary: this._summarizeInput(update.rawInput),
      });
    } else if (kind === 'tool_call_update') {
      if (update.status === 'completed') {
        this._upsertToolStatus({ toolCallId: update.toolCallId, status: 'done' });
      } else if (update.status === 'failed') {
        this._upsertToolStatus({ toolCallId: update.toolCallId, status: 'error' });
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

    if (messageId && this._messageIdMap.has(messageId)) {
      const idx = this._messageIdMap.get(messageId)!;
      const msg = this.messages[idx];
      if (msg) {
        msg.text += text;
        return;
      }
    }

    const id = messageId ?? `${role}-${Date.now()}-${Math.random()}`;
    const newMsg: ChatMessage = { id, role, text, streaming: true };
    const idx = this.messages.length;
    this.messages.push(newMsg);
    if (messageId) this._messageIdMap.set(messageId, idx);
  }

  private _upsertToolStatus(patch: Partial<ToolStatus> & { toolCallId: string }): void {
    const existing = this.toolStatuses.find((t) => t.toolCallId === patch.toolCallId);
    if (existing) {
      Object.assign(existing, patch);
    } else {
      this.toolStatuses.push({
        toolCallId: patch.toolCallId,
        toolName: patch.toolName ?? '(tool)',
        status: patch.status ?? 'running',
        inputSummary: patch.inputSummary,
      });
    }
  }

  private _summarizeInput(input: unknown): string | undefined {
    if (!input || typeof input !== 'object') return undefined;
    const keys = Object.keys(input as Record<string, unknown>);
    if (keys.length === 0) return undefined;
    return keys.slice(0, 3).join(', ');
  }
}
