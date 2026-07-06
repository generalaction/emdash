import type {
  ChatContext,
  ChatImageAttachment,
  ChatMessage,
  ChatState,
  ChatView,
} from '@emdash/chat-ui';
import { createChatState, pinTopMode } from '@emdash/chat-ui';
import type { PromptInput, QueuedPrompt } from '@emdash/core/acp/client';
import type {
  CommandItem,
  ComposerEffortOption,
  ComposerModelOption,
  ComposerPermissionModeOption,
  ComposerQueuedPrompt,
} from '@emdash/ui/react/components';
import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { workspaceRegistry } from '@renderer/features/tasks/stores/workspace-registry';
import { AcpLiveSession } from '@renderer/lib/acp/acp-live-session';
import {
  registerConversationCommands,
  unregisterConversationCommands,
} from '@renderer/lib/chat/advertised-command-provider';
import { getSharedChatContext } from '@renderer/lib/chat/shared-chat-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { conversationRegistry } from '../stores/conversation-registry';
import { mapTranscriptTurn, mapTranscriptTurns } from './acp-live-mapper';

export type AcpChatLifecycle =
  | 'idle'
  | 'starting'
  | 'replaying'
  | 'ready'
  | 'working'
  | 'cancelling'
  | 'closed';

export interface AgentAffordances {
  isWorking: boolean;
  isBusy: boolean;
  hasPendingPermission: boolean;
  canSubmit: boolean;
  canCancel: boolean;
}

export type AcpPromptImage = {
  data: string;
  mimeType: string;
  name?: string;
};

type PermissionQueueItem = {
  requestId: string;
  title: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
};

export class AcpChatStore {
  readonly chatContext: ChatContext;
  readonly chatState: ChatState;

  session: AcpLiveSession | null = null;
  historyLoading = true;
  loadError: string | null = null;
  messageCount = 0;

  private _view: ChatView | null = null;
  private _bootstrapped = false;
  private _unsubs: Array<() => void> = [];

  constructor(
    readonly conversationId: string,
    readonly projectId: string,
    readonly taskId: string
  ) {
    this.chatContext = getSharedChatContext();
    this.chatState = createChatState(this.chatContext, { uri: conversationId });
    registerConversationCommands(conversationId, () =>
      this.commands.map((command) => command.name)
    );

    makeObservable(this, {
      session: observable.ref,
      historyLoading: observable,
      loadError: observable,
      messageCount: observable,
      lifecycle: computed,
      model: computed,
      modelOptions: computed,
      permissionMode: computed,
      permissionModeOptions: computed,
      effort: computed,
      effortOptions: computed,
      commands: computed,
      permissionQueue: computed,
      queuedPrompts: computed,
      affordances: computed,
      isEmpty: computed,
      submitPrompt: action,
      stop: action,
      setModel: action,
      setMode: action,
      setEffort: action,
      resolvePermission: action,
      editQueuedPrompt: action,
      deleteQueuedPrompt: action,
      reorderQueuedPrompts: action,
      sendQueuedPromptNow: action,
      retry: action,
    });
  }

  get lifecycle(): AcpChatLifecycle {
    return this.session?.sessionState.getSnapshot()?.lifecycle ?? 'idle';
  }

  get model(): string | null {
    return this.session?.config.getSnapshot()?.modelOptions?.selected ?? null;
  }

  get modelOptions(): Record<string, ComposerModelOption> | null {
    const options = this.session?.config.getSnapshot()?.modelOptions;
    if (!options) return null;
    return Object.fromEntries(
      options.available.map((option) => [
        option.id,
        { name: option.name, description: option.description },
      ])
    );
  }

  get permissionMode(): string | null {
    return this.session?.config.getSnapshot()?.modeOptions?.selected ?? null;
  }

  get permissionModeOptions(): Record<string, ComposerPermissionModeOption> | null {
    const options = this.session?.config.getSnapshot()?.modeOptions;
    if (!options) return null;
    return Object.fromEntries(
      options.available.map((option) => [option.id, { name: option.name }])
    );
  }

  get effort(): string | null {
    return this.session?.config.getSnapshot()?.efforts?.selected ?? null;
  }

  get effortOptions(): Record<string, ComposerEffortOption> | null {
    const options = this.session?.config.getSnapshot()?.efforts;
    if (!options) return null;
    return Object.fromEntries(
      options.available.map((option) => [
        option.id,
        { name: option.name, description: option.description },
      ])
    );
  }

  get commands(): CommandItem[] {
    return (this.session?.config.getSnapshot()?.availableCommands ?? []).map((command) => ({
      id: command.name,
      name: command.name,
      description: command.description,
      behavior: 'insert',
    }));
  }

  get permissionQueue(): PermissionQueueItem[] {
    return (this.session?.sessionState.getSnapshot()?.pendingPermissions ?? []).map((request) => ({
      requestId: request.requestId,
      title: request.toolCall.title,
      options: request.options.map((option) => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      })),
    }));
  }

  get queuedPrompts(): ComposerQueuedPrompt[] {
    return this._queuedPromptModels().map((prompt) => ({
      id: prompt.id,
      text: prompt.text,
    }));
  }

  get lastStopReason(): string | null {
    return this.session?.sessionState.getSnapshot()?.lastStopReason ?? null;
  }

  get usage(): {
    contextUsed: number;
    contextSize: number;
    cost?: { amount: number; currency: string } | null;
  } | null {
    return null;
  }

  get affordances(): AgentAffordances {
    const state = this.session?.sessionState.getSnapshot();
    return {
      isWorking: state?.isGenerating ?? false,
      isBusy: state?.isGenerating ?? false,
      hasPendingPermission: (state?.pendingPermissions.length ?? 0) > 0,
      canSubmit: state?.canSubmit ?? false,
      canCancel: state?.canCancel ?? false,
    };
  }

  get isEmpty(): boolean {
    return !this.historyLoading && this.messageCount === 0;
  }

  bootstrap(): void {
    if (this._bootstrapped) return;
    this._bootstrapped = true;
    void this._runBootstrap();
  }

  retry(): void {
    if (this.historyLoading || !this.loadError) return;
    this.historyLoading = true;
    this.loadError = null;
    void this._runBootstrap();
  }

  bindView(view: ChatView | null): void {
    this._view = view;
  }

  submitPrompt(text: string, images?: AcpPromptImage[]): void {
    if (!this.affordances.isWorking) {
      const optimisticId = `optimistic:user:${Date.now()}`;
      const optimistic: ChatMessage = {
        kind: 'message',
        id: optimisticId,
        role: 'user',
        text,
        attachments: images?.map(toChatImageAttachment),
      };
      this.chatState.transcript.activeTurn.set([optimistic], 'generating');
      this._syncMessageCount();
      const pinMode = pinTopMode(optimisticId);
      this._view?.setScrollMode(pinMode);
      this.chatState.scroll.set(pinMode);
    }

    void this.session
      ?.sendPrompt({ text })
      .then((result) => {
        if (!result.success) this._toastError('Failed to send message', result.error);
      })
      .catch((error: unknown) => this._toastError('Failed to send message', error));
  }

  stop(): void {
    void this.session
      ?.cancelTurn()
      .then((result) => {
        if (!result.success) this._toastError('Failed to stop', result.error);
      })
      .catch((error: unknown) => this._toastError('Failed to stop', error));
  }

  setModel(model: string): void {
    void this.session?.setModelOption('model', model);
  }

  setMode(modeId: string): void {
    void this.session?.setModeOption(modeId);
  }

  setEffort(effort: string): void {
    void this.session?.setModelOption('effort', effort);
  }

  resolvePermission(optionId: string): void {
    const request = this.permissionQueue[0];
    if (!request) return;
    void this.session?.resolvePermission(request.requestId, optionId);
  }

  editQueuedPrompt(id: string, text: string): void {
    const existing = this._queuedPromptModels().find((prompt) => prompt.id === id);
    if (!existing) return;
    const input: PromptInput = {
      text,
      attachments: existing.attachments,
    };
    void this.session
      ?.editQueuedPrompt(id, input)
      .then((result) => {
        if (!result.success) this._toastError('Failed to edit queued prompt', result.error);
      })
      .catch((error: unknown) => this._toastError('Failed to edit queued prompt', error));
  }

  deleteQueuedPrompt(id: string): void {
    void this.session
      ?.deleteQueuedPrompt(id)
      .then((result) => {
        if (!result.success) this._toastError('Failed to delete queued prompt', result.error);
      })
      .catch((error: unknown) => this._toastError('Failed to delete queued prompt', error));
  }

  reorderQueuedPrompts(ids: string[]): void {
    void this.session
      ?.changeQueuePromptOrder(ids)
      .then((result) => {
        if (!result.success) this._toastError('Failed to reorder queued prompts', result.error);
      })
      .catch((error: unknown) => this._toastError('Failed to reorder queued prompts', error));
  }

  sendQueuedPromptNow(id: string): void {
    void this._sendQueuedPromptNow(id);
  }

  dispose(): void {
    unregisterConversationCommands(this.conversationId);
    this._unsubs.splice(0).forEach((unsub) => unsub());
    this.session?.dispose();
    this.chatState.dispose();
  }

  private async _runBootstrap(): Promise<void> {
    try {
      const input = this._startInput();
      const clientSession = await AcpLiveSession.create(this.conversationId, input);

      const history = await clientSession.getHistory(undefined, 100);
      if (!history.success) throw resultError(history.error);

      runInAction(() => {
        this.session?.dispose();
        this.session = clientSession;
        this.chatState.transcript.history.seed(mapTranscriptTurns(history.data.turns));
        this._subscribeLiveSession(clientSession);
        this.historyLoading = false;
        this.loadError = null;
        this._syncMessageCount();
      });
    } catch (error) {
      runInAction(() => {
        this.historyLoading = false;
        this.loadError = error instanceof Error ? error.message : 'Failed to load chat.';
      });
    }
  }

  private _startInput() {
    const conversation = conversationRegistry
      .get(this.taskId)
      ?.conversations.get(this.conversationId)?.data;
    if (!conversation) throw new Error('Conversation not found');

    const task = asProvisioned(getTaskStore(this.projectId, this.taskId));
    if (!task?.workspaceId) throw new Error('No workspace found for task');

    const workspace = workspaceRegistry.get(this.projectId, task.workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    return {
      conversationId: this.conversationId,
      projectId: this.projectId,
      taskId: this.taskId,
      providerId: conversation.providerId,
      workspaceId: task.workspaceId,
      cwd: workspace.path,
      sessionId: conversation.sessionId ?? null,
      model: conversation.model ?? null,
    };
  }

  private _queuedPromptModels(): QueuedPrompt[] {
    return this.session?.sessionState.getSnapshot()?.queuedPrompts ?? [];
  }

  private async _sendQueuedPromptNow(id: string): Promise<void> {
    const current = this._queuedPromptModels();
    if (!current.some((prompt) => prompt.id === id)) return;

    const ids = [id, ...current.map((prompt) => prompt.id).filter((promptId) => promptId !== id)];
    const reorderResult = await this.session?.changeQueuePromptOrder(ids);
    if (!reorderResult?.success) {
      this._toastError('Failed to send queued prompt', reorderResult?.error);
      return;
    }

    if (!this.affordances.isWorking) return;
    const cancelResult = await this.session?.cancelTurn();
    if (!cancelResult?.success) {
      this._toastError('Failed to send queued prompt', cancelResult?.error);
    }
  }

  private _subscribeLiveSession(session: AcpLiveSession): void {
    this._unsubs.splice(0).forEach((unsub) => unsub());
    this._unsubs.push(
      session.sessionState.subscribe(() => runInAction(() => this._syncMessageCount())),
      session.config.subscribe(() => runInAction(() => {})),
      session.activeTurn.subscribe(() => {
        const turn = session.activeTurn.getSnapshot();
        runInAction(() => {
          this.chatState.transcript.activeTurn.set(
            turn ? mapTranscriptTurn(turn, { active: true }) : null,
            turn ? 'generating' : 'done'
          );
          if (!turn) void this._refreshHistory();
          this._syncMessageCount();
        });
      })
    );
  }

  private async _refreshHistory(): Promise<void> {
    const history = await this.session?.getHistory(undefined, 100);
    if (!history?.success) return;
    runInAction(() => {
      this.chatState.transcript.history.seed(mapTranscriptTurns(history.data.turns));
      this._syncMessageCount();
    });
  }

  private _syncMessageCount(): void {
    const state = this.chatState.transcript.state;
    this.messageCount = state.committed.length + (state.activeTurn?.length ?? 0);
  }

  private _toastError(title: string, error: unknown): void {
    toast({
      title,
      description: error instanceof Error ? error.message : undefined,
      variant: 'destructive',
    });
  }
}

function toChatImageAttachment(img: AcpPromptImage): ChatImageAttachment {
  return {
    id: crypto.randomUUID(),
    name: img.name ?? 'image',
    dataUrl: `data:${img.mimeType};base64,${img.data}`,
  };
}

function resultError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    const type = (error as { type?: unknown }).type;
    return new Error(typeof message === 'string' ? message : String(type ?? 'Unknown error'));
  }
  return new Error(String(error));
}
