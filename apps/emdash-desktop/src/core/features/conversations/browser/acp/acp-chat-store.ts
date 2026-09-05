import type { ChatContext, ChatImageAttachment, ChatState, ChatView } from '@emdash/chat-ui';
import { formatHostRef } from '@emdash/core/primitives/host/api';
import type {
  AttachmentMimeType,
  AttachmentRef,
  PromptAttachment,
  PromptInput,
  QueuedPrompt,
  SessionMcpServer,
} from '@emdash/core/runtimes/acp/api/client';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import type {
  CommandItem,
  ComposerCollaborationModeOption,
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
import {
  getConversationsClient,
  type ConversationsClient,
} from '@core/features/conversations/api/browser/client';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import { updateProviderPreference } from '@core/features/conversations/browser/provider-preferences';
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
import { AcpLiveSession, AcpStartError, asValueSource } from './acp-live-session';
import { bindSessionTerminalOutputs } from './acp-terminal-output-binding';

export interface AgentAffordances {
  isWorking: boolean;
  isBusy: boolean;
  isResuming: boolean;
  hasPendingPermission: boolean;
  canSubmit: boolean;
  canCancel: boolean;
}

type StoredPromptAttachment = Extract<PromptAttachment, { type: 'attachment' }>;

const draftAttachmentDataUrlCache = new Map<string, string>();

export type AcpPromptAttachment = {
  ref: StoredPromptAttachment;
  previewUrl?: string;
};

type AcpAttachmentUploadMetadata = {
  mimeType: AttachmentMimeType;
  name?: string;
};

export type AcpAttachmentUploadInput = AcpAttachmentUploadMetadata &
  (
    | { data: Uint8Array; source?: never; size?: never }
    | { data?: never; source: BlobSource; size?: number }
  );

type PermissionQueueItem = {
  requestId: string;
  title: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
};

export type AcpLoadError =
  | { kind: 'auth_required'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'generic'; message: string };

export class AcpChatStore {
  readonly chatContext: ChatContext;
  readonly chatState: ChatState;

  session: AcpLiveSession | null = null;
  historyLoading = true;
  loadError: AcpLoadError | null = null;
  messageCount = 0;
  draftText = '';
  draftAttachments: AcpPromptAttachment[] = [];

  private _view: ChatView | null = null;
  private _bootstrapped = false;
  private _unsubs: Array<() => void> = [];
  private readonly _scope: Scope;
  private readonly _draftSpace: SubjectSpace<'conversation'>;
  private readonly _draftHandle: MementoHandle<AcpDraftState>;
  private readonly _disposeHostReaction: () => void;
  private _acpClientPromise: Promise<ConversationsClient['acp']> | null = null;
  private _submissionSequence = 0;
  private _historyRefreshRequested = false;
  private _historyRefreshTask: Promise<void> | null = null;
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
      draftAttachments: observable.shallow,
      model: computed,
      modelOptions: computed,
      permissionMode: computed,
      permissionModeOptions: computed,
      collaborationMode: computed,
      collaborationModeOptions: computed,
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
      setCollaborationMode: action,
      setEffort: action,
      resolvePermission: action,
      editQueuedPrompt: action,
      deleteQueuedPrompt: action,
      reorderQueuedPrompts: action,
      sendQueuedPromptNow: action,
      setDraftText: action,
      addDraftAttachments: action,
      removeDraftAttachment: action,
      exportTranscript: action,
      retry: action,
    });
    const initialHost = this.hostAccess?.state;
    let lastHostGeneration = initialHost?.kind === 'ready' ? initialHost.hostGeneration : undefined;
    this._disposeHostReaction = reaction(
      () => this.hostAccess?.state,
      (state) => {
        const kind = state?.kind;
        if (state?.kind === 'ready') {
          const changed = state.hostGeneration !== lastHostGeneration;
          lastHostGeneration = state.hostGeneration;
          const session = this.session;
          if (changed && session) {
            void session
              .revalidate()
              .then(() => {
                if (this._disposed || this.session !== session || !session.usable) return;
                runInAction(() => {
                  this.loadError = null;
                });
              })
              .catch((error) => {
                if (this._disposed || this.session !== session) return;
                runInAction(() => {
                  this.loadError = toLoadError(error);
                });
              });
          }
        }
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
        attachments: this.draftAttachments.map(({ ref }) => ({
          id: ref.id,
          mimeType: ref.mimeType,
          name: ref.name,
        })),
      }),
      this._scope
    );
    void this._draftSpace.ready.then(
      () => {
        runInAction(() => {
          if (this._disposed || this.draftText !== '' || this.draftAttachments.length > 0) return;
          const stored = this._draftHandle.value;
          this.draftText = stored.text;
          this.draftAttachments = stored.attachments.map((attachment) => ({
            ref: { type: 'attachment', ...attachment },
          }));
        });
        void this._rehydrateDraftAttachmentPreviews();
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

  get collaborationMode(): string | null {
    return this.session?.config.current().collaborationModeOptions?.selected ?? null;
  }

  get collaborationModeOptions(): Record<string, ComposerCollaborationModeOption> | null {
    const options = this.session?.config.current().collaborationModeOptions;
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
    const liveActionsEnabled =
      this.hostAccess?.liveAction.kind !== 'disabled' && (this.session?.usable ?? false);
    const isResuming = state?.lifecycle === 'starting' || state?.lifecycle === 'replaying';
    return {
      isWorking: state?.isGenerating ?? false,
      isBusy: state?.isGenerating ?? false,
      isResuming,
      hasPendingPermission: (state?.pendingPermissions.length ?? 0) > 0,
      canSubmit: liveActionsEnabled && (state?.canSubmit ?? false),
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

  async uploadAttachment(input: AcpAttachmentUploadInput): Promise<AttachmentRef | null> {
    if (this.hostAccess?.liveAction.kind === 'disabled') return null;
    try {
      const client = await this._getAcpClient();
      const result = await client.uploadAttachment(
        { conversationId: this.conversationId },
        {
          name: input.name ?? 'attachment',
          mimeType: input.mimeType,
          size: input.size ?? input.data?.byteLength,
          source: input.source ?? singleChunk(input.data),
        }
      );
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

  async downloadAttachment(id: string) {
    const client = await this._getAcpClient();
    const result = await client.downloadAttachment({
      conversationId: this.conversationId,
      attachmentId: id,
    });
    if (!result.success) return result;
    return {
      success: true as const,
      data: {
        ref: result.data.meta,
        data: await result.data.bytes(),
      },
    };
  }

  async deleteAttachment(id: string): Promise<void> {
    try {
      const client = await this._getAcpClient();
      const result = await client.deleteAttachment({
        conversationId: this.conversationId,
        attachmentId: id,
      });
      if (!result.success) this._toastError('Failed to delete attachment', result.error);
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
    const submissionSequence = ++this._submissionSequence;
    let optimisticId: string | undefined;
    this.draftText = '';
    this.draftAttachments = [];
    if (!this.affordances.isWorking) {
      optimisticId = `optimistic:user:${Date.now()}`;
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

    void this._submitPrompt(text, promptAttachments, hiddenContext).then((accepted) => {
      if (accepted) return;
      runInAction(() => {
        if (this._disposed || submissionSequence !== this._submissionSequence) return;
        if (optimisticId && this.chatState.session.state.pendingPrompt?.id === optimisticId) {
          this.chatState.session.setPendingPrompt(null);
          this._syncMessageCount();
        }
        if (this.draftText !== '' || this.draftAttachments.length > 0) return;
        this.draftText = text;
        this.draftAttachments = attachments;
      });
    });
  }

  setDraftText(text: string): void {
    if (text === this.draftText) return;
    this.draftText = text;
  }

  addDraftAttachments(attachments: AcpPromptAttachment[]): void {
    if (attachments.length === 0) return;
    const existingIds = new Set(this.draftAttachments.map(({ ref }) => ref.id));
    const additions = attachments.filter(({ ref }) => !existingIds.has(ref.id));
    if (additions.length === 0) return;
    this.draftAttachments = [...this.draftAttachments, ...additions];
    if (additions.some((attachment) => !attachment.previewUrl)) {
      void this._rehydrateDraftAttachmentPreviews();
    }
  }

  removeDraftAttachment(id: string): void {
    if (!this.draftAttachments.some(({ ref }) => ref.id === id)) return;
    this.draftAttachments = this.draftAttachments.filter(({ ref }) => ref.id !== id);
    void this.deleteAttachment(id);
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
      ?.setOption('model', model)
      .then((result) => {
        if (!result.success) {
          this._toastError('Failed to change model', result.error);
          return;
        }
        void this._rememberPreference({ model });
      })
      .catch((error: unknown) => this._toastError('Failed to change model', error));
  }

  setMode(modeId: string): void {
    void this.session
      ?.setOption('mode', modeId)
      .then((result) => {
        if (!result.success) {
          this._toastError('Failed to change session mode', result.error);
          return;
        }
        void this._rememberPreference({ modeId });
      })
      .catch((error: unknown) => this._toastError('Failed to change session mode', error));
  }

  setCollaborationMode(modeId: string): void {
    void this.session
      ?.setOption('collaborationMode', modeId)
      .then((result) => {
        if (!result.success) {
          this._toastError('Failed to change collaboration mode', result.error);
          return;
        }
        void this._rememberPreference({ collaborationMode: modeId });
      })
      .catch((error: unknown) => this._toastError('Failed to change collaboration mode', error));
  }

  setEffort(effort: string): void {
    void this.session
      ?.setOption('effort', effort)
      .then((result) => {
        if (!result.success) {
          this._toastError('Failed to change effort', result.error);
          return;
        }
        void this._rememberPreference({ effort });
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
    let clientSession: AcpLiveSession | null = null;
    try {
      const attachedSession = await AcpLiveSession.create(this.conversationId);
      clientSession = attachedSession;

      runInAction(() => {
        this.session?.dispose();
        this.session = attachedSession;
        this._subscribeLiveSession(attachedSession);
      });

      const history = await attachedSession.loadHistory(undefined, 100);
      if (!history.success) throw new AcpStartError(history.error);
      if (history.data.clearedConfiguration?.length) {
        await this._rememberPreference(
          Object.fromEntries(history.data.clearedConfiguration.map((key) => [key, null])) as {
            model?: null;
            modeId?: null;
            effort?: null;
            collaborationMode?: null;
          }
        );
      }

      runInAction(() => {
        if (!history.data.unavailable) {
          this.chatState.transcript.history.seed(history.data.turns);
        }
        this.historyLoading = false;
        this.loadError = null;
        this._syncMessageCount();
      });
      void this._rehydrateDraftAttachmentPreviews();
    } catch (error) {
      log.error('ACP chat bootstrap failed', {
        conversationId: this.conversationId,
        projectId: this.projectId,
        taskId: this.taskId,
        error,
      });
      runInAction(() => {
        if (clientSession && this.session !== clientSession) clientSession.dispose();
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
  ): Promise<boolean> {
    if (this.hostAccess?.liveAction.kind === 'disabled') return false;
    const session = this.session;
    if (!session || !session.usable) {
      this._toastError('Failed to send message', new Error('ACP session is not connected'));
      return false;
    }

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
      const result = await session.sendPrompt({
        text,
        ...(resolvedHiddenContext ? { hiddenContext: resolvedHiddenContext } : {}),
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      if (!result.success) {
        this._toastError('Failed to send message', result.error);
        return false;
      }
      return true;
    } catch (error) {
      this._toastError('Failed to send message', error);
      return false;
    }
  }

  private async _sendQueuedPromptNow(id: string): Promise<void> {
    const current = this._queuedPromptModels();
    if (!current.some((prompt) => prompt.id === id)) return;

    const shouldCancelActiveTurn = this.affordances.isWorking;
    const ids = [id, ...current.map((prompt) => prompt.id).filter((promptId) => promptId !== id)];
    const reorderResult = await this.session?.changeQueuePromptOrder(ids);
    if (!reorderResult?.success) {
      this._toastError('Failed to send queued prompt', reorderResult?.error);
      return;
    }

    if (!shouldCancelActiveTurn) return;
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
    let previousLifecycle = session.sessionState.current().lifecycle;
    const disconnectChatSession = getChatUiRuntime().connectSession(
      this.chatState,
      {
        activeTurn: asValueSource(session.activeTurn),
        plan: asValueSource(session.plan),
        sessionState: asValueSource(session.sessionState),
      },
      {
        onTurnCommitted: () => this._requestHistoryRefresh(),
      }
    );
    this._unsubs.push(
      disconnectChatSession,
      this._bindTerminalOutputs(session),
      session.sessionState.onChange((state) => {
        const replayCompleted = previousLifecycle === 'replaying' && state.lifecycle === 'ready';
        previousLifecycle = state.lifecycle;
        runInAction(() => {
          this._syncMessageCount();
        });
        if (replayCompleted) this._requestHistoryRefresh();
      }),
      session.activeTurn.onChange(() => runInAction(() => this._syncMessageCount()))
    );
  }

  private async _rehydrateDraftAttachmentPreviews(): Promise<void> {
    const pending = this.draftAttachments.filter((attachment) => !attachment.previewUrl);
    await Promise.all(
      pending.map(async (attachment) => {
        const previewUrl = await resolveDraftAttachmentDataUrl(
          this.conversationId,
          this,
          attachment.ref.id
        );
        runInAction(() => {
          if (this._disposed) return;
          const current = this.draftAttachments.find(({ ref }) => ref.id === attachment.ref.id);
          if (!current || current.previewUrl) return;
          if (previewUrl.kind === 'resolved') {
            this.draftAttachments = this.draftAttachments.map((candidate) =>
              candidate.ref.id === attachment.ref.id
                ? { ...candidate, previewUrl: previewUrl.dataUrl }
                : candidate
            );
          } else if (previewUrl.kind === 'not_found') {
            this.draftAttachments = this.draftAttachments.filter(
              ({ ref }) => ref.id !== attachment.ref.id
            );
          }
        });
      })
    );
  }

  private _getAcpClient(): Promise<ConversationsClient['acp']> {
    this._acpClientPromise ??= getConversationsClient().then((client) => client.acp);
    return this._acpClientPromise;
  }

  private async _rememberPreference(patch: {
    model?: string | null;
    modeId?: string | null;
    effort?: string | null;
    collaborationMode?: string | null;
  }): Promise<void> {
    const providerId = conversationRegistry.get(this.taskId)?.conversations.get(this.conversationId)
      ?.data.providerId;
    if (!providerId) return;
    const host = formatHostRef(hostRefFromConnectionId(getProjectSshConnectionId(this.projectId)));
    try {
      await updateProviderPreference(host, providerId, 'acp', patch);
    } catch (error) {
      getMementoClient().reportError(error);
    }
  }

  private _bindTerminalOutputs(session: AcpLiveSession): () => void {
    return bindSessionTerminalOutputs(session, (terminalId, snapshot) =>
      this.chatState.session.setTerminalOutput(terminalId, snapshot)
    );
  }

  private _requestHistoryRefresh(): void {
    this._historyRefreshRequested = true;
    if (this._historyRefreshTask) return;

    const task = Promise.resolve()
      .then(async () => {
        while (this._historyRefreshRequested && !this._disposed) {
          this._historyRefreshRequested = false;
          await this._refreshHistory();
        }
      })
      .finally(() => {
        if (this._historyRefreshTask === task) this._historyRefreshTask = null;
        if (this._historyRefreshRequested && !this._disposed) this._requestHistoryRefresh();
      });
    this._historyRefreshTask = task;
  }

  private async _refreshHistory(): Promise<void> {
    const session = this.session;
    if (!session) return;

    try {
      const history = await session.loadHistory(undefined, 100);
      if (!history.success || history.data.unavailable || this.session !== session) return;
      // A waking prompt may begin between replay completion and this response. Do not let a
      // replay-history seed reset the newly active turn; its normal completion refresh will seed
      // the authoritative history instead.
      if (this.chatState.transcript.state.activeTurnSnapshot !== null) return;
      runInAction(() => {
        const pendingPrompt = this.chatState.session.state.pendingPrompt;
        this.chatState.transcript.history.seed(history.data.turns);
        if (pendingPrompt && this.chatState.session.state.pendingPrompt === null) {
          this.chatState.session.setPendingPrompt(pendingPrompt);
        }
        this._syncMessageCount();
      });
    } catch (error) {
      log.warn('Failed to refresh ACP history', {
        conversationId: this.conversationId,
        error,
      });
    }
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

type DraftAttachmentPreviewResult =
  | { kind: 'resolved'; dataUrl: string }
  | { kind: 'not_found' }
  | { kind: 'unavailable' };

async function resolveDraftAttachmentDataUrl(
  conversationId: string,
  store: AcpChatStore,
  attachmentId: string
): Promise<DraftAttachmentPreviewResult> {
  const cacheKey = `${conversationId}:${attachmentId}`;
  const cached = draftAttachmentDataUrlCache.get(cacheKey);
  if (cached) return { kind: 'resolved', dataUrl: cached };
  try {
    const result = await store.downloadAttachment(attachmentId);
    if (!result.success) {
      return result.error.type === 'attachment_not_found'
        ? { kind: 'not_found' }
        : { kind: 'unavailable' };
    }
    const dataUrl = `data:${result.data.ref.mimeType};base64,${bytesToBase64(result.data.data)}`;
    draftAttachmentDataUrlCache.set(cacheKey, dataUrl);
    return { kind: 'resolved', dataUrl };
  } catch {
    return { kind: 'unavailable' };
  }
}

async function* singleChunk(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function toLoadError(error: unknown): AcpLoadError {
  const message = error instanceof Error ? error.message : 'Failed to load chat.';
  if (error instanceof AcpStartError && error.errorType === 'auth_required') {
    return { kind: 'auth_required', message };
  }
  return { kind: 'generic', message };
}
