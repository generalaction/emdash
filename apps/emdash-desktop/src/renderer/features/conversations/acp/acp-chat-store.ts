import type { ChatContext, ChatImageAttachment, ChatState, ChatView } from '@emdash/chat-ui';
import { connectSession, createChatState, pinTopMode } from '@emdash/chat-ui';
import type {
  AttachmentMimeType,
  AttachmentRef,
  PromptAttachment,
  PromptDraft,
  PromptInput,
  QueuedPrompt,
  SessionMcpServer,
} from '@emdash/core/runtimes/acp/api/client';
import type {
  CommandItem,
  ComposerEffortOption,
  ComposerModelOption,
  ComposerPermissionModeOption,
  ComposerQueuedPrompt,
} from '@emdash/ui/react/components';
import type { BlobSource } from '@emdash/wire';
import { action, computed, makeObservable, observable, runInAction, toJS } from 'mobx';
// TODO(conversations-extraction): Inject task/workspace lookups instead of importing task stores.
import { asProvisioned, getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { workspaceRegistry } from '@renderer/features/tasks/stores/workspace-registry';
import { AcpLiveSession, AcpStartError, asValueSource } from '@renderer/lib/acp/acp-live-session';
import { getAgentConfigRuntimeClient } from '@renderer/lib/agent-config/runtime-client';
import {
  registerConversationCommands,
  unregisterConversationCommands,
} from '@renderer/lib/chat/advertised-command-provider';
import { getSharedChatContext } from '@renderer/lib/chat/shared-chat-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { conversationRegistry } from '../stores/conversation-registry';
import { bindSessionTerminalOutputs } from './acp-terminal-output-binding';

export interface AgentAffordances {
  isWorking: boolean;
  isBusy: boolean;
  hasPendingPermission: boolean;
  canSubmit: boolean;
  canCancel: boolean;
}

type StoredPromptAttachment = Extract<PromptAttachment, { type: 'attachment' }>;

export type AcpPromptAttachment = {
  ref: StoredPromptAttachment;
  previewUrl?: string;
};

type PermissionQueueItem = {
  requestId: string;
  title: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
};

export type AcpLoadError =
  | { kind: 'auth_required'; message: string }
  | { kind: 'generic'; message: string };

export class AcpChatStore {
  readonly chatContext: ChatContext;
  readonly chatState: ChatState;

  session: AcpLiveSession | null = null;
  historyLoading = true;
  loadError: AcpLoadError | null = null;
  messageCount = 0;
  draftText = '';

  private _view: ChatView | null = null;
  private _bootstrapped = false;
  private _unsubs: Array<() => void> = [];
  private _draftRev = 0;
  private _pendingDraftRev: number | null = null;
  private _draftTimer: number | null = null;

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
      draftText: observable,
      model: computed,
      modelOptions: computed,
      permissionMode: computed,
      permissionModeOptions: computed,
      effort: computed,
      effortOptions: computed,
      commands: computed,
      mcpServers: computed,
      permissionQueue: computed,
      queuedPrompts: computed,
      usage: computed,
      affordances: computed,
      isEmpty: computed,
      submitPrompt: action,
      queuePrompt: action,
      stop: action,
      setModel: action,
      setMode: action,
      setEffort: action,
      resolvePermission: action,
      editQueuedPrompt: action,
      deleteQueuedPrompt: action,
      reorderQueuedPrompts: action,
      sendQueuedPromptNow: action,
      setDraftText: action,
      exportTranscript: action,
      retry: action,
    });
  }

  get model(): string | null {
    return this.session?.config.current().modelOptions?.selected ?? null;
  }

  get modelOptions(): Record<string, ComposerModelOption> | null {
    const options = this.session?.config.current().modelOptions;
    if (!options) return null;
    return Object.fromEntries(
      options.available.map((option) => [
        option.id,
        { name: option.name, description: option.description },
      ])
    );
  }

  get permissionMode(): string | null {
    return this.session?.config.current().modeOptions?.selected ?? null;
  }

  get permissionModeOptions(): Record<string, ComposerPermissionModeOption> | null {
    const options = this.session?.config.current().modeOptions;
    if (!options) return null;
    return Object.fromEntries(
      options.available.map((option) => [
        option.id,
        { name: option.name, description: option.description },
      ])
    );
  }

  get effort(): string | null {
    return this.session?.config.current().efforts?.selected ?? null;
  }

  get effortOptions(): Record<string, ComposerEffortOption> | null {
    const options = this.session?.config.current().efforts;
    if (!options) return null;
    return Object.fromEntries(
      options.available.map((option) => [
        option.id,
        { name: option.name, description: option.description },
      ])
    );
  }

  get commands(): CommandItem[] {
    return (this.session?.config.current().availableCommands ?? []).map((command) => ({
      id: command.name,
      name: command.name,
      description: command.description,
      behavior: 'insert',
    }));
  }

  get mcpServers(): SessionMcpServer[] {
    return this.session?.mcpServers.current() ?? [];
  }

  get permissionQueue(): PermissionQueueItem[] {
    return (this.session?.sessionState.current().pendingPermissions ?? []).map((request) => ({
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

  get usage(): {
    contextUsed: number;
    contextSize: number;
    cost?: { amount: number; currency: string } | null;
  } | null {
    return this.session?.usage.current() ?? null;
  }

  get affordances(): AgentAffordances {
    const state = this.session?.sessionState.current();
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

  async uploadAttachment(input: {
    data?: Uint8Array;
    source?: BlobSource;
    size?: number;
    mimeType: AttachmentMimeType;
    name?: string;
    originalPath?: string;
  }): Promise<AttachmentRef | null> {
    try {
      const result = await this.session?.uploadAttachment(input);
      if (!result) {
        this._toastError('Failed to upload attachment', new Error('ACP session is not connected'));
        return null;
      }
      if (!result.success) {
        this._toastError('Failed to upload attachment', result.error);
        return null;
      }
      return result.data;
    } catch (error) {
      this._toastError('Failed to upload attachment', error);
      return null;
    }
  }

  async deleteAttachment(id: string): Promise<void> {
    try {
      const result = await this.session?.deleteAttachment(id);
      if (result && !result.success) this._toastError('Failed to delete attachment', result.error);
    } catch (error) {
      this._toastError('Failed to delete attachment', error);
    }
  }

  submitPrompt(
    text: string,
    attachments: AcpPromptAttachment[] = [],
    hiddenContext?: string
  ): void {
    const promptAttachments = attachments.map((attachment) => attachment.ref);
    if (!this.affordances.isWorking) {
      const optimisticId = `optimistic:user:${Date.now()}`;
      this.chatState.session.setPendingPrompt({
        id: optimisticId,
        text,
        attachments: attachments.map(toPendingAttachment),
      });
      this._syncMessageCount();
      const pinMode = pinTopMode(optimisticId);
      this._view?.setScrollMode(pinMode);
      this.chatState.scroll.set(pinMode);
    }

    void this.session
      ?.sendPrompt({
        text,
        ...(hiddenContext ? { hiddenContext } : {}),
        ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
      })
      .then((result) => {
        if (!result.success) this._toastError('Failed to send message', result.error);
      })
      .catch((error: unknown) => this._toastError('Failed to send message', error));
  }

  queuePrompt(text: string, attachments: AcpPromptAttachment[] = [], hiddenContext?: string): void {
    const promptAttachments = attachments.map((attachment) => attachment.ref);
    void this.session
      ?.queuePrompt({
        text,
        ...(hiddenContext ? { hiddenContext } : {}),
        ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
      })
      .then((result) => {
        if (!result.success) this._toastError('Failed to queue message', result.error);
      })
      .catch((error: unknown) => this._toastError('Failed to queue message', error));
  }

  setDraftText(text: string): void {
    if (text === this.draftText) return;
    this.draftText = text;
    this._draftRev += 1;
    this._pendingDraftRev = this._draftRev;
    this._scheduleDraftWrite(text, this._draftRev);
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
    void this.session
      ?.setModelOption('model', model)
      .then((result) => {
        if (!result.success) this._toastError('Failed to change model', result.error);
      })
      .catch((error: unknown) => this._toastError('Failed to change model', error));
  }

  setMode(modeId: string): void {
    void this.session
      ?.setModeOption(modeId)
      .then((result) => {
        if (!result.success) this._toastError('Failed to change session mode', result.error);
      })
      .catch((error: unknown) => this._toastError('Failed to change session mode', error));
  }

  setEffort(effort: string): void {
    void this.session
      ?.setModelOption('effort', effort)
      .then((result) => {
        if (!result.success) this._toastError('Failed to change effort', result.error);
      })
      .catch((error: unknown) => this._toastError('Failed to change effort', error));
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
      hiddenContext: existing.hiddenContext,
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

  exportTranscript(kind: 'parsed' | 'raw'): void {
    void this._exportTranscript(kind);
  }

  dispose(): void {
    unregisterConversationCommands(this.conversationId);
    if (this._draftTimer !== null) {
      window.clearTimeout(this._draftTimer);
      this._draftTimer = null;
    }
    this._unsubs.splice(0).forEach((unsub) => unsub());
    this.session?.dispose();
    this.chatState.dispose();
  }

  private async _runBootstrap(): Promise<void> {
    let providerId: string | undefined;
    try {
      const input = this._startInput();
      providerId = input.providerId;
      const clientSession = await AcpLiveSession.create(this.conversationId, input);

      const history = await clientSession.getHistory(undefined, 100);
      if (!history.success) throw resultError(history.error);

      runInAction(() => {
        this.session?.dispose();
        this.session = clientSession;
        this.chatState.transcript.history.seed(history.data.turns);
        this._subscribeLiveSession(clientSession);
        this._applyDraftSnapshot(clientSession.draft.current());
        this.historyLoading = false;
        this.loadError = null;
        this._syncMessageCount();
      });
    } catch (error) {
      log.error('ACP chat bootstrap failed', {
        conversationId: this.conversationId,
        projectId: this.projectId,
        taskId: this.taskId,
        error,
      });
      runInAction(() => {
        this.historyLoading = false;
        this.loadError = toLoadError(error);
      });
      if (this.loadError?.kind === 'auth_required' && providerId) {
        void this._refreshAuthStatus(providerId);
      }
    }
  }

  private async _refreshAuthStatus(providerId: string): Promise<void> {
    try {
      const client = await getAgentConfigRuntimeClient();
      const result = await client.refreshAuthStatus({ providerId });
      if (!result.success) {
        log.warn('Failed to refresh agent auth status after ACP auth error', {
          providerId,
          error: result.error,
        });
      }
    } catch (error) {
      log.warn('Failed to refresh agent auth status after ACP auth error', {
        providerId,
        error,
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

    const initialQueue =
      conversation.sessionId === undefined && conversation.initialQueue?.length
        ? toJS(conversation.initialQueue)
        : undefined;

    return {
      conversationId: this.conversationId,
      providerId: conversation.providerId,
      cwd: workspace.path,
      sessionId: conversation.sessionId ?? null,
      model: conversation.model ?? null,
      ...(initialQueue && { initialQueue }),
    };
  }

  private _queuedPromptModels(): QueuedPrompt[] {
    return this.session?.sessionState.current().queuedPrompts ?? [];
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

  private async _exportTranscript(kind: 'parsed' | 'raw'): Promise<void> {
    const session = this.session;
    if (!session) {
      this._toastError('Failed to export transcript', new Error('Chat is not loaded.'));
      return;
    }

    try {
      const result =
        kind === 'raw' ? await session.exportRawAcpLog() : await session.exportTranscript();
      if (!result.success) {
        this._toastError('Failed to export transcript', result.error);
        return;
      }

      const label = kind === 'raw' ? 'raw ACP log' : 'parsed transcript';
      const suffix = kind === 'raw' ? 'acp-raw' : 'transcript';
      const saved = await rpc.app.saveTextFile({
        title: `Export ${label}`,
        defaultPath: `${this.conversationId}-${suffix}.json`,
        content: result.data,
      });
      if (!saved.success) {
        this._toastError('Failed to save transcript', new Error(saved.error));
        return;
      }
      if (!saved.path) return;
      toast({ title: `Exported ${label}` });
    } catch (error) {
      this._toastError('Failed to export transcript', error);
    }
  }

  private _subscribeLiveSession(session: AcpLiveSession): void {
    this._unsubs.splice(0).forEach((unsub) => unsub());
    const disconnectChatSession = connectSession(
      this.chatState,
      {
        activeTurn: asValueSource(session.activeTurn),
        plan: asValueSource(session.plan),
        sessionState: asValueSource(session.sessionState),
      },
      {
        onTurnCommitted: () => void this._refreshHistory(),
      }
    );
    this._unsubs.push(
      disconnectChatSession,
      this._bindTerminalOutputs(session),
      session.sessionState.onChange(() =>
        runInAction(() => {
          this._syncMessageCount();
        })
      ),
      session.activeTurn.onChange(() => runInAction(() => this._syncMessageCount())),
      session.draft.onChange((draft) =>
        runInAction(() => {
          this._applyDraftSnapshot(draft);
        })
      )
    );
  }

  private _scheduleDraftWrite(text: string, rev: number): void {
    if (this._draftTimer !== null) window.clearTimeout(this._draftTimer);
    this._draftTimer = window.setTimeout(() => {
      this._draftTimer = null;
      const draft = { rev, input: text.trim().length > 0 ? { text } : null };
      void this.session
        ?.setPromptDraft(draft)
        .then((result) => {
          if (!result.success) this._toastError('Failed to sync draft', result.error);
          if (result.success && draft.input === null && this._pendingDraftRev === rev) {
            runInAction(() => {
              this._pendingDraftRev = null;
            });
          }
        })
        .catch((error: unknown) => this._toastError('Failed to sync draft', error));
    }, 300);
  }

  private _applyDraftSnapshot(draft: PromptDraft | null | undefined): void {
    if (draft === undefined) return;
    if (draft === null) {
      if (this._pendingDraftRev === null) {
        this._draftRev += 1;
        this.draftText = '';
      }
      return;
    }

    if (this._pendingDraftRev !== null) {
      if (draft.rev >= this._pendingDraftRev) {
        this._draftRev = Math.max(this._draftRev, draft.rev);
        this._pendingDraftRev = null;
      }
      return;
    }

    if (draft.rev >= this._draftRev) {
      this._draftRev = draft.rev;
      this.draftText = draft.text;
    }
  }

  private _bindTerminalOutputs(session: AcpLiveSession): () => void {
    return bindSessionTerminalOutputs(session, (terminalId, text) =>
      this.chatState.session.setTerminalOutput(terminalId, text)
    );
  }

  private async _refreshHistory(): Promise<void> {
    const history = await this.session?.getHistory(undefined, 100);
    if (!history?.success) return;
    runInAction(() => {
      this.chatState.session.setPendingPrompt(null);
      this.chatState.transcript.history.seed(history.data.turns);
      this._syncMessageCount();
    });
  }

  private _syncMessageCount(): void {
    const state = this.chatState.transcript.state;
    const committedCount = state.committedTurns.reduce(
      (count, turn) => count + turn.items.length,
      0
    );
    const activeCount = state.activeTurnSnapshot?.items.length ?? 0;
    const pendingPromptCount = this.chatState.session.state.pendingPrompt ? 1 : 0;
    this.messageCount = committedCount + activeCount + pendingPromptCount;
  }

  private _toastError(title: string, error: unknown): void {
    toast({
      title,
      description: error instanceof Error ? error.message : undefined,
      variant: 'destructive',
    });
  }
}

function toPendingAttachment(attachment: AcpPromptAttachment): ChatImageAttachment {
  return {
    id: attachment.ref.id,
    name: attachment.ref.name ?? 'image',
    dataUrl: attachment.previewUrl,
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

function toLoadError(error: unknown): AcpLoadError {
  const message = error instanceof Error ? error.message : 'Failed to load chat.';
  if (error instanceof AcpStartError && error.errorType === 'auth_required') {
    return { kind: 'auth_required', message };
  }
  return { kind: 'generic', message };
}
