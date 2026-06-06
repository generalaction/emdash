import { action, makeObservable, observable, runInAction } from 'mobx';
import { events, rpc } from '@renderer/lib/ipc';
import type { IDisposable } from '@renderer/lib/stores/lifecycle';
import { log } from '@renderer/utils/logger';
import { nativeChatEventChannel, type NativeChatEvent } from '@shared/events/nativeChatEvents';
import type { NativeChatOptions, NativeChatAttachment } from '@shared/native-chat';
import {
  applyNativeChatEvent,
  emptyTranscript,
  transcriptFromState,
  type NativeChatTranscript,
} from './native-chat-transcript';

/**
 * Renderer-side state for one native chat conversation: the transcript
 * snapshot (seeded over RPC, kept live via native-chat events) plus composer
 * status.
 */
export class NativeChatStore implements IDisposable {
  transcript: NativeChatTranscript = emptyTranscript();
  isLoading = true;
  isSending = false;
  isSwitching = false;
  sendError: string | null = null;

  private offEvents: (() => void) | null = null;
  /** Events received while the initial getState load is in flight. */
  private pendingEvents: NativeChatEvent[] | null = [];

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

    this.offEvents = events.on(nativeChatEventChannel, (envelope) => {
      if (envelope.conversationId !== this.conversationId) return;
      if (this.pendingEvents) {
        this.pendingEvents.push(envelope.event);
        return;
      }
      this.applyEvent(envelope.event);
    });
    void this.load();
  }

  applyEvent(event: NativeChatEvent): void {
    this.transcript = applyNativeChatEvent(this.transcript, event);
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
      await rpc.nativeChat.sendMessage(
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
      await rpc.nativeChat.interrupt(this.conversationId);
    } catch (error) {
      log.warn('NativeChatStore: interrupt failed', { error });
    }
  }

  async setOptions(options: NativeChatOptions): Promise<void> {
    try {
      await rpc.nativeChat.setOptions(this.projectId, this.taskId, this.conversationId, options);
    } catch (error) {
      log.warn('NativeChatStore: failed to set chat options', { error });
    }
  }

  async switchToTerminal(): Promise<void> {
    if (this.isSwitching) return;
    runInAction(() => {
      this.isSwitching = true;
    });
    try {
      await rpc.nativeChat.switchToTerminal(this.projectId, this.taskId, this.conversationId);
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
      const state = await rpc.nativeChat.getState(this.conversationId);
      runInAction(() => {
        let transcript = transcriptFromState(state);
        for (const event of this.pendingEvents ?? []) {
          transcript = applyNativeChatEvent(transcript, event);
        }
        this.pendingEvents = null;
        this.transcript = transcript;
        this.isLoading = false;
      });
    } catch (error) {
      log.warn('NativeChatStore: failed to load chat state', { error });
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
