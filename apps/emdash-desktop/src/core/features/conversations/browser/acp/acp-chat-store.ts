import type { ChatContext, ChatImageAttachment, ChatState, ChatView } from '@emdash/chat-ui';
import type {
  AttachmentMimeType,
  AttachmentRef,
  PromptAttachment,
  PromptInput,
  QueuedPrompt,
  SessionMcpServer,
} from '@emdash/core/runtimes/acp/api/client';
import type { Result } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import type {
  CommandItem,
  ComposerEffortOption,
  ComposerModelOption,
  ComposerPermissionModeOption,
  ComposerQueuedPrompt,
} from '@emdash/ui/react/components';
import { toast } from '@emdash/ui/react/primitives';
import type { BlobSource } from '@emdash/wire/rpc';
import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import { getAgentsClient, hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import {
  registerConversationCommands,
  unregisterConversationCommands,
} from '@core/features/conversations/api/browser/chat/advertised-command-provider';
import { getChatUiRuntime } from '@core/features/conversations/api/browser/chat/chat-ui-runtime';
import { getSharedChatContext } from '@core/features/conversations/api/browser/chat/shared-chat-context';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import {
  ACP_DRAFT_MAX_LENGTH,
  acpDraftMemento,
  type AcpDraftState,
} from '@core/features/conversations/contributions/mementos';
import { conversationSubject } from '@core/features/conversations/contributions/subject';
import type { ProjectHostAccess } from '@core/features/projects/api/browser/stores/project-context';
import { getProjectSshConnectionId } from '@core/features/projects/api/browser/stores/project-selectors';
import { getHostClient } from '@core/primitives/desktop-host/browser/host-client';
import { log } from '@core/primitives/logging/browser/logger';
import {
  getMementoClient,
  type MementoHandle,
  type SubjectSpace,
} from '@core/primitives/mementos/browser';
import { seedNonEmptyHistory } from './acp-history';
import { AcpLiveSession, AcpStartError, asValueSource } from './acp-live-session';
import { bindSessionTerminalOutputs } from './acp-terminal-output-binding';
import { isActivationLostError } from './activation-errors';

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
  | { kind: 'unavailable'; message: string }
  | { kind: 'inactive'; message: string }
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
  private readonly _scope: Scope;
  private readonly _draftSpace: SubjectSpace<'conversation'>;
  private readonly _draftHandle: MementoHandle<AcpDraftState>;
  private readonly _disposeHostReaction: () => void;
  private _connectPromise: Promise<AcpLiveSession> | null = null;
  private _disposed = false;

  constructor(
    readonly conversationId: string,
    readonly projectId: string,
    readonly taskId: string,
    readonly hostAccess?: ProjectHostAccess
  ) {
    this.chatContext = getSharedChatContext();
    this._scope = createScope({ label: `acp-chat:${conversationId}` });
    this.chatState = getChatUiRuntime().createChatState(this.chatContext, {
      uri: conversationId,
    });
    this._draftSpace = getMementoClient().subject(conversationSubject({ conversationId }));
    this._draftHandle = this._draftSpace.handle(acpDraftMemento);
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
    this._disposeHostReaction = reaction(
      () => this.hostAccess?.state.kind,
      (kind) => {
        if (
          kind === 'ready' &&
          this._bootstrapped &&
          !this.historyLoading &&
          this.loadError?.kind === 'unavailable'
        ) {
          this.historyLoading = true;
          this.loadError = null;
          void this._runBootstrap();
        }
      }
    );
    this._draftHandle.autoPersist(
      () => ({
        version: '1' as const,
        text: this.draftText.slice(0, ACP_DRAFT_MAX_LENGTH),
      }),
      this._scope
    );
    void this._draftSpace.ready.then(
      () => {
        runInAction(() => {
          this.draftText = this._draftHandle.value.text;
        });
      },
      (error: unknown) => getMementoClient().reportError(error)
    );
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
    const liveActionsEnabled = this.hostAccess?.liveAction.kind !== 'disabled';
    return {
      isWorking: state?.isGenerating ?? false,
      isBusy: state?.isGenerating ?? false,
      hasPendingPermission: (state?.pendingPermissions.length ?? 0) > 0,
      canSubmit: liveActionsEnabled && (state?.canSubmit ?? this.loadError?.kind === 'inactive'),
      canCancel: liveActionsEnabled && (state?.canCancel ?? false),
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
    if (this.hostAccess?.liveAction.kind === 'disabled') return null;
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
    hiddenContext?: string | Promise<string | undefined>
  ): void {
    if (this.hostAccess?.liveAction.kind === 'disabled') return;
    const promptAttachments = attachments.map((attachment) => attachment.ref);
    this.draftText = '';
    if (!this.affordances.isWorking) {
      const optimisticId = `optimistic:user:${Date.now()}`;
      this.chatState.session.setPendingPrompt({
        id: optimisticId,
        text,
        attachments: attachments.map(toPendingAttachment),
      });
      this._syncMessageCount();
      const pinMode = getChatUiRuntime().pinTopMode(optimisticId);
      this._view?.setScrollMode(pinMode);
      this.chatState.scroll.set(pinMode);
    }

    void this._submitPrompt(text, promptAttachments, hiddenContext);
  }

  setDraftText(text: string): void {
    if (text === this.draftText) return;
    this.draftText = text;
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
    void this._withConnectedSession('Failed to change model', (session) =>
      session.setModelOption('model', model)
    );
  }

  setMode(modeId: string): void {
    void this._withConnectedSession('Failed to change session mode', (session) =>
      session.setModeOption(modeId)
    );
  }

  setEffort(effort: string): void {
    void this._withConnectedSession('Failed to change effort', (session) =>
      session.setModelOption('effort', effort)
    );
  }

  resolvePermission(optionId: string): void {
    const request = this.permissionQueue[0];
    if (!request) return;
    void this._withConnectedSession('Failed to resolve permission', (session) =>
      session.resolvePermission(request.requestId, optionId)
    );
  }

  editQueuedPrompt(id: string, text: string): void {
    const existing = this._queuedPromptModels().find((prompt) => prompt.id === id);
    if (!existing) return;
    const input: PromptInput = {
      text,
      hiddenContext: existing.hiddenContext,
      attachments: existing.attachments,
    };
    void this._withConnectedSession('Failed to edit queued prompt', (session) =>
      session.editQueuedPrompt(id, input)
    );
  }

  deleteQueuedPrompt(id: string): void {
    void this._withConnectedSession('Failed to delete queued prompt', (session) =>
      session.deleteQueuedPrompt(id)
    );
  }

  reorderQueuedPrompts(ids: string[]): void {
    void this._withConnectedSession('Failed to reorder queued prompts', (session) =>
      session.changeQueuePromptOrder(ids)
    );
  }

  sendQueuedPromptNow(id: string): void {
    void this._sendQueuedPromptNow(id);
  }

  exportTranscript(kind: 'parsed' | 'raw'): void {
    void this._exportTranscript(kind);
  }

  dispose(): void {
    this._disposed = true;
    this._disposeHostReaction();
    unregisterConversationCommands(this.conversationId);
    this._unsubs.splice(0).forEach((unsub) => unsub());
    this.session?.dispose();
    this.chatState.dispose();
    void this._scope
      .dispose()
      .then(() => this._draftSpace.release())
      .catch((error: unknown) => getMementoClient().reportError(error));
  }

  private _connectSession(): Promise<AcpLiveSession> {
    const current = this.session;
    if (
      current &&
      current.activationId.current() !== null &&
      current.sessionState.current().lifecycle !== 'closed'
    ) {
      return Promise.resolve(current);
    }
    if (this._connectPromise) return this._connectPromise;

    const pending = (async () => {
      const clientSession = await AcpLiveSession.create(this.conversationId);
      try {
        const history = await clientSession.getHistory(undefined, 100);
        if (!history.success) throw resultError(history.error);
        if (this._disposed) throw new Error('ACP chat store was disposed while connecting');

        runInAction(() => {
          this.session?.dispose();
          this.session = clientSession;
          seedNonEmptyHistory(history.data.turns, (turns) =>
            this.chatState.transcript.history.seed(turns)
          );
          this._subscribeLiveSession(clientSession);
          this.historyLoading = false;
          this.loadError = null;
          this._syncMessageCount();
        });
        return clientSession;
      } catch (error) {
        clientSession.dispose();
        throw error;
      }
    })().finally(() => {
      if (this._connectPromise === pending) this._connectPromise = null;
    });
    this._connectPromise = pending;
    return pending;
  }

  private _loseSession(session: AcpLiveSession): void {
    if (this.session !== session) return;
    this._unsubs.splice(0).forEach((unsub) => unsub());
    this.session = null;
    session.dispose();
    this.historyLoading = false;
    this.loadError = {
      kind: 'inactive',
      message: 'This chat is inactive. Retry or send a message to reconnect it.',
    };
    this._syncMessageCount();
  }

  private async _withConnectedSession<T>(
    title: string,
    work: (session: AcpLiveSession) => Promise<Result<T, unknown>>
  ): Promise<void> {
    if (this.hostAccess?.liveAction.kind === 'disabled') return;
    try {
      const session = await this._connectSession();
      const result = await work(session);
      if (result.success) return;
      if (isActivationLostError(result.error)) {
        runInAction(() => this._loseSession(session));
        return;
      }
      this._toastError(title, result.error);
    } catch (error) {
      this._toastError(title, error);
    }
  }

  private async _runBootstrap(): Promise<void> {
    if (this.hostAccess?.liveAction.kind === 'disabled') {
      runInAction(() => {
        this.historyLoading = false;
        this.loadError = {
          kind: 'unavailable',
          message: 'Live chat is unavailable until Project access returns.',
        };
      });
      return;
    }
    const providerId = conversationRegistry.get(this.taskId)?.conversations.get(this.conversationId)
      ?.data.providerId;
    try {
      await this._connectSession();
    } catch (error) {
      log.error('ACP chat bootstrap failed', {
        conversationId: this.conversationId,
        projectId: this.projectId,
        taskId: this.taskId,
        error,
      });
      runInAction(() => {
        this.historyLoading = false;
        this.loadError =
          this.hostAccess?.liveAction.kind === 'disabled'
            ? {
                kind: 'unavailable',
                message: 'Live chat is unavailable until Project access returns.',
              }
            : toLoadError(error);
      });
      if (this.loadError?.kind === 'auth_required' && providerId) {
        void this._refreshAuthStatus(providerId);
      }
    }
  }

  private async _refreshAuthStatus(providerId: string): Promise<void> {
    try {
      const host = hostRefFromConnectionId(getProjectSshConnectionId(this.projectId));
      const client = await getAgentsClient();
      const result = await client.refreshAuthStatus({ host, providerId });
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

  private _queuedPromptModels(): QueuedPrompt[] {
    return this.session?.sessionState.current().queuedPrompts ?? [];
  }

  private async _submitPrompt(
    text: string,
    attachments: StoredPromptAttachment[],
    hiddenContext?: string | Promise<string | undefined>
  ): Promise<void> {
    if (this.hostAccess?.liveAction.kind === 'disabled') return;
    let resolvedHiddenContext: string | undefined;
    try {
      resolvedHiddenContext = await hiddenContext;
    } catch (error) {
      log.warn('Failed to resolve issue context for ACP prompt', {
        conversationId: this.conversationId,
        error,
      });
    }

    try {
      let session = await this._connectSession();
      const prompt: PromptInput = {
        text,
        ...(resolvedHiddenContext ? { hiddenContext: resolvedHiddenContext } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      };
      let result = await session.sendPrompt(prompt);
      if (!result.success && isActivationLostError(result.error)) {
        runInAction(() => this._loseSession(session));
        session = await this._connectSession();
        result = await session.sendPrompt(prompt);
      }
      if (!result.success) this._toastError('Failed to send message', result.error);
    } catch (error) {
      this._toastError('Failed to send message', error);
    }
  }

  private async _sendQueuedPromptNow(id: string): Promise<void> {
    const current = this._queuedPromptModels();
    if (!current.some((prompt) => prompt.id === id)) return;

    const shouldCancelActiveTurn = this.affordances.isWorking;
    const ids = [id, ...current.map((prompt) => prompt.id).filter((promptId) => promptId !== id)];
    let session: AcpLiveSession;
    try {
      session = await this._connectSession();
    } catch (error) {
      this._toastError('Failed to send queued prompt', error);
      return;
    }
    const reorderResult = await session.changeQueuePromptOrder(ids);
    if (!reorderResult.success) {
      this._toastError('Failed to send queued prompt', reorderResult.error);
      return;
    }

    if (!shouldCancelActiveTurn) return;
    const cancelResult = await session.cancelTurn();
    if (!cancelResult.success) {
      this._toastError('Failed to send queued prompt', cancelResult.error);
    }
  }

  private async _exportTranscript(kind: 'parsed' | 'raw'): Promise<void> {
    try {
      const session = await this._connectSession();
      const result =
        kind === 'raw' ? await session.exportRawAcpLog() : await session.exportTranscript();
      if (!result.success) {
        this._toastError('Failed to export transcript', result.error);
        return;
      }

      const label = kind === 'raw' ? 'raw ACP log' : 'parsed transcript';
      const suffix = kind === 'raw' ? 'acp-raw' : 'transcript';
      const saved = await (
        await getHostClient()
      ).saveTextFile({
        title: `Export ${label}`,
        defaultPath: `${this.conversationId}-${suffix}.json`,
        content: result.data,
      });
      if (!saved.success) {
        this._toastError('Failed to save transcript', new Error(saved.error));
        return;
      }
      if (!saved.path) return;
      toast(`Exported ${label}`);
    } catch (error) {
      this._toastError('Failed to export transcript', error);
    }
  }

  private _subscribeLiveSession(session: AcpLiveSession): void {
    this._unsubs.splice(0).forEach((unsub) => unsub());
    const disconnectChatSession = getChatUiRuntime().connectSession(
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
    const activationId = session.activationId.current();
    const detectHandleLoss = (): void => {
      if (this.session !== session) return;
      const currentActivationId = session.activationId.current();
      if (
        currentActivationId !== activationId ||
        currentActivationId === null ||
        session.sessionState.current().lifecycle === 'closed'
      ) {
        this._loseSession(session);
      }
    };
    this._unsubs.push(
      disconnectChatSession,
      this._bindTerminalOutputs(session),
      session.sessionState.onChange(() =>
        runInAction(() => {
          this._syncMessageCount();
          detectHandleLoss();
        })
      ),
      session.activeTurn.onChange(() => runInAction(() => this._syncMessageCount())),
      session.activationId.onChange(() => runInAction(detectHandleLoss))
    );
  }

  private _bindTerminalOutputs(session: AcpLiveSession): () => void {
    return bindSessionTerminalOutputs(session, (terminalId, snapshot) =>
      this.chatState.session.setTerminalOutput(terminalId, snapshot)
    );
  }

  private async _refreshHistory(): Promise<void> {
    const history = await this.session?.getHistory(undefined, 100);
    if (!history?.success) return;
    runInAction(() => {
      if (
        !seedNonEmptyHistory(history.data.turns, (turns) =>
          this.chatState.transcript.history.seed(turns)
        )
      ) {
        return;
      }
      this.chatState.session.setPendingPrompt(null);
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
    toast.error(title, { description: error instanceof Error ? error.message : undefined });
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
