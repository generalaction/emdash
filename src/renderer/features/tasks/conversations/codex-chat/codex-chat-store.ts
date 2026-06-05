import { action, makeObservable, observable, runInAction } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import type { IDisposable } from '@renderer/lib/stores/lifecycle';
import { log } from '@renderer/utils/logger';
import { codexChatEventChannel, type CodexChatEvent } from '@shared/events/codexChatEvents';
import type { CodexChatOptions, NativeChatAttachment } from '@shared/native-chat';
import {
  applyCodexChatEvent,
  emptyTranscript,
  transcriptFromState,
  type CodexChatTranscript,
} from './codex-chat-transcript';

/**
 * Renderer-side state for one native Codex chat conversation: the transcript
 * snapshot (seeded over RPC, kept live via codex-chat events) plus composer
 * status.
 */
export class CodexChatStore implements IDisposable {
  transcript: CodexChatTranscript = emptyTranscript();
  isLoading = true;
  isSending = false;
  isSwitching = false;
  sendError: string | null = null;

  private offEvents: (() => void) | null = null;
  /** Events received while the initial getState load is in flight. */
  private pendingEvents: CodexChatEvent[] | null = [];

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    private readonly conversationId: string
  ) {
    makeObservable(this, {
      transcript: observable.ref,
      isLoading: observable,
      isSending: observable,
      isSwitching: observable,
      sendError: observable,
      applyEvent: action,
      clearSendError: action,
    });

    this.offEvents = events.on(codexChatEventChannel, (envelope) => {
      if (envelope.conversationId !== this.conversationId) return;
      if (this.pendingEvents) {
        this.pendingEvents.push(envelope.event);
        return;
      }
      this.applyEvent(envelope.event);
    });
    void this.load();
  }

  applyEvent(event: CodexChatEvent): void {
    this.transcript = applyCodexChatEvent(this.transcript, event);
  }

  clearSendError(): void {
    this.sendError = null;
  }

  async send(text: string, attachments: NativeChatAttachment[] = []): Promise<void> {
    const trimmed = text.trim();
    if (
      (!trimmed && attachments.length === 0) ||
      this.isSending ||
      this.transcript.turnStatus === 'running'
    ) {
      return;
    }
    runInAction(() => {
      this.isSending = true;
      this.sendError = null;
    });
    try {
      await rpc.codexChat.sendMessage(
        this.projectId,
        this.taskId,
        this.conversationId,
        trimmed,
        attachments
      );
    } catch (error) {
      runInAction(() => {
        this.sendError = error instanceof Error ? error.message : String(error);
      });
    } finally {
      runInAction(() => {
        this.isSending = false;
      });
    }
  }

  async interrupt(): Promise<void> {
    try {
      await rpc.codexChat.interrupt(this.conversationId);
    } catch (error) {
      log.warn('CodexChatStore: interrupt failed', { error });
    }
  }

  async setOptions(options: CodexChatOptions): Promise<void> {
    try {
      await rpc.codexChat.setOptions(this.projectId, this.taskId, this.conversationId, options);
    } catch (error) {
      log.warn('CodexChatStore: failed to set chat options', { error });
    }
  }

  async switchToTerminal(): Promise<void> {
    if (this.isSwitching) return;
    runInAction(() => {
      this.isSwitching = true;
    });
    try {
      await rpc.codexChat.switchToTerminal(this.projectId, this.taskId, this.conversationId);
    } catch (error) {
      runInAction(() => {
        this.isSwitching = false;
        this.sendError = error instanceof Error ? error.message : String(error);
      });
    }
    // On success the conversation's uiMode change re-routes the panel to the
    // terminal surface and this store is disposed by the panel unmount.
  }

  private async load(): Promise<void> {
    try {
      const state = await rpc.codexChat.getState(this.conversationId);
      runInAction(() => {
        let transcript = transcriptFromState(state);
        for (const event of this.pendingEvents ?? []) {
          transcript = applyCodexChatEvent(transcript, event);
        }
        this.pendingEvents = null;
        this.transcript = transcript;
        this.isLoading = false;
      });
    } catch (error) {
      log.warn('CodexChatStore: failed to load chat state', { error });
      runInAction(() => {
        this.pendingEvents = null;
        this.isLoading = false;
      });
    }
  }

  dispose(): void {
    this.offEvents?.();
    this.offEvents = null;
  }
}
