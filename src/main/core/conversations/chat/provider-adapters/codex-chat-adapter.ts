import {
  execFile,
  spawn,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { buildAgentEnv } from '@main/core/pty/pty-env';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { log } from '@main/lib/logger';
import type { ConversationControls } from '@shared/conversation-controls';
import type {
  AppendConversationTimelineItemInput,
  ConversationPermissionRequestTimelineItem,
  ConversationPermissionResponse,
  ConversationStatus,
  ConversationToolCallStatus,
  SendConversationMessageInput,
} from '@shared/conversation-timeline';
import { parseShellWords } from '../../impl/agent-command';
import { resolveProviderEnv } from '../../impl/provider-env';
import {
  CodexAppServerClient,
  type CodexModel,
  type CodexAppServerNotification,
  type CodexSandboxPolicy,
  type CodexSkill,
  type CodexUserInput,
} from '../app-server/codex-app-server-client';
import { CodexAppServerTransport } from '../app-server/codex-app-server-transport';
import type {
  AgentSlashCommand,
  AgentSlashCommandInput,
  ChatProviderAdapter,
  ChatProviderRuntimeEvent,
  ChatProviderSession,
  ChatSessionConfig,
} from '../types';

type PendingPermission = {
  kind: 'approval' | 'question';
  defaultAnswers?: Record<string, { answers: string[] }>;
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
};

const CODEX_GOALS_MIN_VERSION: readonly [number, number, number] = [0, 128, 0];
const CODEX_VERSION_TIMEOUT_MS = 2_000;
const GIT_ROOT_TIMEOUT_MS = 2_000;
const CODEX_FAST_MODE_SUPPORTED_MODEL_PREFIXES = ['gpt-5', 'gpt-4.1', 'o3', 'o4-mini'] as const;

class CodexChatSession implements ChatProviderSession {
  readonly conversationId: string;
  readonly providerId = 'codex' as const;
  providerSessionId?: string;
  activeTurnId?: string;
  readonly goalsEnabled: boolean;
  private readonly assistantTextByItemId = new Map<string, string>();
  private readonly callbacks = new Set<(event: ChatProviderRuntimeEvent) => void>();
  private cachedSkills: CodexSkill[] = [];
  private skillsLoadedFromAppServer = false;
  private turnPreparationCancelGeneration = 0;
  private readonly pendingTurnPreparationGenerations = new Set<number>();
  private eventQueue = Promise.resolve();
  private readonly commandOutputDeltaByCallId = new Map<string, string>();
  private readonly execCommandCallIds = new Set<string>();
  private readonly execCommandInputByCallId = new Map<
    string,
    { command?: unknown; cwd?: string }
  >();
  private readonly fileChangeOutputDeltaByItemId = new Map<string, string>();
  private readonly pendingPermissions = new Map<string, PendingPermission>();
  private readonly progressToolCallIds = new Set<string>();
  private readonly progressToolCallPayloads = new Map<
    string,
    { input?: unknown; output?: string; toolName: string }
  >();
  private readonly reasoningTextByItemId = new Map<string, string>();
  private readonly runningToolCallPayloads = new Map<
    string,
    { input?: unknown; output?: string; toolName: string }
  >();
  private model: string | undefined;
  private serviceTier: 'fast' | undefined;
  private turnStartPending = false;
  private eventHandler: (event: ChatProviderRuntimeEvent) => void | Promise<void> = () => {};

  constructor(
    readonly client: CodexAppServerClient,
    conversationId: string,
    readonly cwd: string,
    readonly autoApprove: boolean | undefined,
    goalsEnabled: boolean,
    providerSessionId?: string
  ) {
    this.conversationId = conversationId;
    this.goalsEnabled = goalsEnabled;
    this.providerSessionId = providerSessionId;
    this.client.onNotification((notification) => this.handleNotification(notification));
    this.client.onExit((error) => this.handleExit(error));
    for (const method of [
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/tool/requestUserInput',
      'tool/requestUserInput',
    ]) {
      this.client.onRequest(method, (params, requestId) =>
        this.handlePermissionRequest(method, params, requestId)
      );
    }
  }

  subscribe(callback: (event: ChatProviderRuntimeEvent) => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  async dispose(): Promise<void> {
    for (const [requestId, pending] of this.pendingPermissions) {
      pending.reject(new Error(`Permission request ${requestId} was cancelled`));
    }
    this.pendingPermissions.clear();
    await this.client.dispose();
  }

  resolvePermission(
    request: ConversationPermissionRequestTimelineItem,
    response: ConversationPermissionResponse
  ): void {
    const pending = this.pendingPermissions.get(request.requestId);
    if (!pending) throw new Error('Permission request not found');
    this.pendingPermissions.delete(request.requestId);
    const approved = response.optionId === 'approve';
    if (pending.kind === 'question') {
      pending.resolve({
        answers: approved ? answersForQuestionResponse(response, pending.defaultAnswers) : {},
      });
      return;
    }
    pending.resolve({ decision: approved ? 'accept' : 'decline' });
  }

  emitStatusMessage(text: string): void {
    this.emit({
      type: 'timeline',
      item: { kind: 'assistant_message', payload: { text } },
    });
  }

  getModel(): string | undefined {
    return this.model;
  }

  setModel(model: string | undefined): void {
    this.model = model;
    if (!codexModelSupportsFastMode(model)) {
      this.serviceTier = undefined;
    }
  }

  getServiceTier(): 'fast' | undefined {
    return this.serviceTier;
  }

  setFastMode(enabled: boolean): void {
    this.serviceTier = enabled ? 'fast' : undefined;
  }

  emitCompleted(): void {
    this.activeTurnId = undefined;
    this.turnStartPending = false;
    this.emit({ type: 'status', status: 'completed' });
  }

  markTurnStartPending(): void {
    this.turnStartPending = true;
  }

  clearTurnStartPending(): void {
    this.turnStartPending = false;
  }

  beginTurnPreparation(): number {
    const generation = this.turnPreparationCancelGeneration;
    this.pendingTurnPreparationGenerations.add(generation);
    return generation;
  }

  endTurnPreparation(generation: number): void {
    this.pendingTurnPreparationGenerations.delete(generation);
  }

  throwIfTurnPreparationCancelled(generation: number): void {
    if (generation !== this.turnPreparationCancelGeneration) {
      throw new Error('Message send was cancelled');
    }
  }

  async loadSkills(): Promise<void> {
    try {
      this.cachedSkills = await this.client.listSkills(this.cwd);
      this.skillsLoadedFromAppServer = true;
    } catch (error) {
      log.debug('CodexChatAdapter: failed to load app-server skills', {
        conversationId: this.conversationId,
        error,
      });
    }
  }

  getSkills(): CodexSkill[] {
    return this.cachedSkills;
  }

  hasAppServerSkillMetadata(): boolean {
    return this.skillsLoadedFromAppServer;
  }

  async cancel(): Promise<void> {
    const threadId = requireThreadId(this);
    if (this.activeTurnId) {
      await this.client.interruptTurn({ threadId, turnId: this.activeTurnId });
      return;
    }
    if (this.turnStartPending) {
      throw new Error('Cannot interrupt Codex turn before app-server reports turn start');
    }
    if (this.pendingTurnPreparationGenerations.size > 0) {
      this.turnPreparationCancelGeneration += 1;
      this.pendingTurnPreparationGenerations.clear();
    }
  }

  private handleExit(error: Error | undefined): void {
    const message = error?.message ?? 'Codex app-server exited';
    const hadActiveWork =
      this.turnStartPending || Boolean(this.activeTurnId) || this.pendingPermissions.size > 0;
    this.cancelPendingPermissions('Codex app-server exited');
    if (hadActiveWork) {
      this.completeProgressToolCalls('failed');
      this.finalizeRunningToolCalls('failed', message);
      this.activeTurnId = undefined;
      this.turnStartPending = false;
      this.clearTurnBuffers();
      this.emit({
        type: 'timeline',
        item: { kind: 'error', payload: { message } },
      });
      this.emit({ type: 'status', status: 'error' });
    }
  }

  private handleNotification(notification: CodexAppServerNotification): void {
    switch (notification.type) {
      case 'thread-started': {
        this.providerSessionId = notification.threadId;
        this.emit({ type: 'provider-session', providerSessionId: notification.threadId });
        break;
      }
      case 'turn-started': {
        this.turnStartPending = false;
        this.activeTurnId = notification.turnId;
        this.emit({ type: 'status', status: 'working' });
        break;
      }
      case 'turn-completed': {
        const failed =
          notification.status === 'failed' ||
          notification.status === 'error' ||
          Boolean(notification.errorMessage);
        if (notification.errorMessage) {
          this.emit({
            type: 'timeline',
            item: { kind: 'error', payload: { message: notification.errorMessage } },
          });
        }
        const status: ConversationStatus = failed
          ? 'error'
          : notification.status === 'interrupted'
            ? 'idle'
            : 'completed';
        const terminalToolStatus: ConversationToolCallStatus = failed
          ? 'failed'
          : notification.status === 'interrupted'
            ? 'cancelled'
            : 'completed';
        this.completeProgressToolCalls(terminalToolStatus);
        this.finalizeRunningToolCalls(
          terminalToolStatus,
          notification.errorMessage ?? `Turn ${terminalToolStatus}`
        );
        this.activeTurnId = undefined;
        this.turnStartPending = false;
        this.cancelPendingPermissions('Turn completed');
        this.clearTurnBuffers();
        this.emit({ type: 'status', status });
        break;
      }
      case 'plan-updated': {
        const id = `plan:${this.activeTurnId ?? this.providerSessionId ?? 'current'}`;
        this.progressToolCallIds.add(id);
        const payload = {
          toolName: 'plan',
          status: 'running' as const,
          output: renderPlan(notification.plan),
          input: { plan: notification.plan },
        };
        this.progressToolCallPayloads.set(id, payload);
        this.emitToolCall(id, payload);
        break;
      }
      case 'diff-updated': {
        const id = `diff:${this.activeTurnId ?? this.providerSessionId ?? 'current'}`;
        this.progressToolCallIds.add(id);
        const payload = {
          toolName: 'diff',
          status: 'running' as const,
          output: notification.diff,
        };
        this.progressToolCallPayloads.set(id, payload);
        this.emitToolCall(id, payload);
        break;
      }
      case 'token-usage-updated': {
        break;
      }
      case 'assistant-delta': {
        this.emitTextDelta('assistant_message', this.assistantTextByItemId, notification);
        break;
      }
      case 'reasoning-delta': {
        this.emitTextDelta('reasoning', this.reasoningTextByItemId, notification);
        break;
      }
      case 'exec-command-output-delta': {
        appendBufferedDelta(
          this.commandOutputDeltaByCallId,
          notification.callId,
          notification.delta,
          { decodeBase64: true }
        );
        break;
      }
      case 'exec-command': {
        if (notification.callId) {
          if (notification.phase === 'started') {
            this.execCommandInputByCallId.set(notification.callId, {
              command: notification.command,
              cwd: notification.cwd,
            });
          }
        }
        const item = mapExecCommandNotification(
          notification,
          this.commandOutputDeltaByCallId,
          this.execCommandInputByCallId,
          this.cwd
        );
        if (notification.callId && hasAuthoritativeExecPayload(item)) {
          this.execCommandCallIds.add(notification.callId);
        }
        if (item) this.emitToolCallItem(item);
        break;
      }
      case 'terminal-interaction': {
        const item = mapTerminalInteractionNotification(notification);
        if (item) this.emitToolCallItem(item);
        break;
      }
      case 'patch-apply': {
        const item = mapPatchApplyNotification(
          notification,
          this.fileChangeOutputDeltaByItemId,
          this.cwd
        );
        if (item) this.emitToolCallItem(item);
        break;
      }
      case 'file-change-output-delta': {
        appendBufferedDelta(
          this.fileChangeOutputDeltaByItemId,
          notification.itemId,
          notification.delta
        );
        break;
      }
      case 'item': {
        const item = mapToolItem(
          notification,
          this.fileChangeOutputDeltaByItemId,
          this.execCommandCallIds,
          this.execCommandInputByCallId
        );
        if (item) this.emitToolCallItem(item);
        break;
      }
      case 'thread-compacted': {
        this.emit({
          type: 'timeline',
          item: { kind: 'reasoning', payload: { text: 'Context compacted.' } },
        });
        break;
      }
      case 'unknown':
        break;
    }
  }

  private emitTextDelta(
    kind: 'assistant_message' | 'reasoning',
    textByItemId: Map<string, string>,
    notification: Extract<
      CodexAppServerNotification,
      { type: 'assistant-delta' | 'reasoning-delta' }
    >
  ): void {
    const text = `${textByItemId.get(notification.itemId) ?? ''}${notification.delta}`;
    textByItemId.set(notification.itemId, text);
    this.emit({
      type: 'timeline',
      item: {
        id: notification.itemId,
        kind,
        payload: { text },
      },
      upsert: true,
    });
  }

  private handlePermissionRequest(
    method: string,
    params: unknown,
    requestId: number
  ): Promise<unknown> {
    const record = typeof params === 'object' && params !== null ? params : {};
    const itemId =
      'itemId' in record && typeof record.itemId === 'string' ? record.itemId : String(requestId);
    const baseTimelineRequestId = `permission-${itemId}`;
    const timelineRequestId = this.pendingPermissions.has(baseTimelineRequestId)
      ? `${baseTimelineRequestId}-${requestId}`
      : baseTimelineRequestId;
    const title = titleForPermissionRequest(method, record);
    const body = bodyForPermissionRequest(record);
    const kind = permissionKindForMethod(method);
    const questionsInput = kind === 'question' ? questionsInputForRequest(record) : undefined;
    const defaultAnswers =
      kind === 'question' ? defaultAnswersForQuestions(questionsInput) : undefined;
    this.emit({
      type: 'timeline',
      item: {
        id: timelineRequestId,
        kind: 'permission_request',
        payload: {
          requestId: timelineRequestId,
          title,
          body,
          input: questionsInput,
          options: [
            { id: 'approve', label: 'Approve', kind: 'primary' },
            { id: 'deny', label: 'Deny', kind: 'danger' },
          ],
          status: 'pending',
        },
      },
      upsert: true,
    });
    this.emit({ type: 'status', status: 'awaiting-input' });
    return new Promise((resolve, reject) => {
      this.pendingPermissions.set(timelineRequestId, {
        defaultAnswers,
        kind,
        reject,
        resolve,
      });
    });
  }

  private emit(event: ChatProviderRuntimeEvent): void {
    this.eventQueue = this.eventQueue
      .then(() => this.eventHandler(event))
      .catch((error) => {
        log.warn('CodexChatSession: failed to forward provider event', {
          conversationId: this.conversationId,
          error: String(error),
        });
      });
    for (const callback of this.callbacks) {
      callback(event);
    }
  }

  setEventHandler(handler: (event: ChatProviderRuntimeEvent) => void | Promise<void>): void {
    this.eventHandler = handler;
  }

  private clearTurnBuffers(): void {
    this.commandOutputDeltaByCallId.clear();
    this.execCommandCallIds.clear();
    this.execCommandInputByCallId.clear();
    this.fileChangeOutputDeltaByItemId.clear();
    this.progressToolCallIds.clear();
    this.progressToolCallPayloads.clear();
    this.runningToolCallPayloads.clear();
  }

  private completeProgressToolCalls(status: ConversationToolCallStatus): void {
    for (const id of this.progressToolCallIds) {
      const existing = this.progressToolCallPayloads.get(id);
      this.emit({
        type: 'timeline',
        item: {
          id,
          kind: 'tool_call',
          payload: {
            input: existing?.input,
            output: existing?.output,
            toolName: existing?.toolName ?? (id.startsWith('plan:') ? 'plan' : 'diff'),
            status,
          },
        },
        upsert: true,
      });
    }
  }

  private finalizeRunningToolCalls(status: ConversationToolCallStatus, message: string): void {
    for (const [id, existing] of this.runningToolCallPayloads) {
      this.emitToolCall(id, {
        ...existing,
        status,
        error: status === 'failed' ? message : undefined,
      });
    }
  }

  private cancelPendingPermissions(reason: string): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      pending.reject(new Error(`Permission request ${requestId} was cancelled: ${reason}`));
    }
    this.pendingPermissions.clear();
  }

  private emitToolCall(
    id: string,
    payload: {
      error?: string;
      input?: unknown;
      output?: string;
      status: ConversationToolCallStatus;
      toolName: string;
    }
  ): void {
    if (payload.status === 'running') {
      this.runningToolCallPayloads.set(id, payload);
    } else {
      this.runningToolCallPayloads.delete(id);
    }
    this.emit({
      type: 'timeline',
      item: {
        id,
        kind: 'tool_call',
        payload,
      },
      upsert: true,
    });
  }

  private emitToolCallItem(item: AppendConversationTimelineItemInput): void {
    if (item.kind !== 'tool_call') {
      this.emit({ type: 'timeline', item, upsert: true });
      return;
    }
    this.emitToolCall(item.id ?? `tool:${Date.now()}`, item.payload);
  }
}

export class CodexChatAdapter implements ChatProviderAdapter {
  readonly providerId = 'codex' as const;

  async createSession(config: ChatSessionConfig): Promise<ChatProviderSession> {
    return this.createOrResumeSession(config);
  }

  async resumeSession(config: ChatSessionConfig): Promise<ChatProviderSession> {
    return this.createOrResumeSession(config);
  }

  private async createOrResumeSession(config: ChatSessionConfig): Promise<ChatProviderSession> {
    const { client, goalsEnabled } = await createCodexClient(config);
    const session = new CodexChatSession(
      client,
      config.conversation.id,
      config.cwd,
      config.conversation.autoApprove,
      goalsEnabled,
      config.conversation.providerSessionId
    );
    session.setEventHandler(config.onEvent);
    const threadId = config.conversation.providerSessionId;
    if (threadId) {
      const loadedThreadIds = await client.listLoadedThreads();
      if (!loadedThreadIds.includes(threadId)) {
        await client.resumeThread({
          threadId,
          cwd: config.cwd,
        });
      }
      return session;
    }

    const providerSessionId = await client.startThread({
      cwd: config.cwd,
      ...codexPermissionParams(config.conversation.autoApprove),
    });
    session.providerSessionId = providerSessionId;
    return session;
  }

  async sendMessage(
    session: ChatProviderSession,
    input: SendConversationMessageInput
  ): Promise<void> {
    const codexSession = requireCodexSession(session);
    const threadId = requireThreadId(codexSession);
    const preparationGeneration = codexSession.beginTurnPreparation();
    try {
      const inputItems = await this.buildPromptInput(codexSession, input.text);
      codexSession.throwIfTurnPreparationCancelled(preparationGeneration);
      codexSession.markTurnStartPending();
      codexSession.endTurnPreparation(preparationGeneration);
      await codexSession.client.startTurn({
        threadId,
        cwd: codexSession.cwd,
        input: inputItems,
        ...(codexSession.getModel() ? { model: codexSession.getModel() } : {}),
        ...(codexSession.getServiceTier() ? { serviceTier: codexSession.getServiceTier() } : {}),
        ...codexTurnPermissionParams(codexSession.autoApprove),
      });
    } catch (error) {
      codexSession.endTurnPreparation(preparationGeneration);
      codexSession.clearTurnStartPending();
      throw error;
    }
  }

  async tryHandleOutOfBandCommand(
    session: ChatProviderSession,
    input: SendConversationMessageInput
  ): Promise<boolean> {
    const slashCommand = parseSlashCommand(input.text);
    if (!slashCommand || (slashCommand.name !== 'compact' && slashCommand.name !== 'goal')) {
      return false;
    }
    const codexSession = requireCodexSession(session);
    if (slashCommand.name === 'goal' && !codexSession.goalsEnabled) {
      return false;
    }
    await this.executeSlashCommand(session, slashCommand);
    return true;
  }

  async cancel(session: ChatProviderSession): Promise<void> {
    await requireCodexSession(session).cancel();
  }

  async respondToPermission(
    session: ChatProviderSession,
    request: ConversationPermissionRequestTimelineItem,
    response: ConversationPermissionResponse
  ): Promise<void> {
    requireCodexSession(session).resolvePermission(request, response);
  }

  async dispose(session: ChatProviderSession): Promise<void> {
    await requireCodexSession(session).dispose();
  }

  async listCommands(session: ChatProviderSession): Promise<AgentSlashCommand[]> {
    const codexSession = requireCodexSession(session);
    await codexSession.loadSkills();
    const appServerSkills = enabledCodexSkills(codexSession.getSkills()).map((skill) => ({
      name: skill.name,
      description: skill.description,
      argumentHint: '',
      execution: 'prompt' as const,
    }));
    const fallbackSkills = codexSession.hasAppServerSkillMetadata()
      ? []
      : await listCodexFallbackSkills(codexSession.cwd);
    const commands: AgentSlashCommand[] = [
      {
        name: 'compact',
        description: 'Compact Codex context',
        argumentHint: '',
        execution: 'out-of-band',
      },
    ];
    if (codexSession.goalsEnabled) {
      commands.push({
        name: 'goal',
        description: 'Set, pause, resume, or clear the Codex goal',
        argumentHint: '[<objective>|pause|resume|clear]',
        execution: 'out-of-band',
      });
    }
    const prompts = await listCodexCustomPrompts();
    return [...commands, ...appServerSkills, ...fallbackSkills, ...prompts].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }

  async executeSlashCommand(
    session: ChatProviderSession,
    command: AgentSlashCommandInput
  ): Promise<void> {
    const codexSession = requireCodexSession(session);
    const threadId = requireThreadId(codexSession);
    if (command.name === 'compact') {
      await codexSession.client.compactThread(threadId);
      codexSession.emitCompleted();
      return;
    }
    if (command.name === 'goal') {
      if (!codexSession.goalsEnabled) {
        throw new Error('Codex goals are not supported by this Codex version');
      }
      const trimmed = command.args?.trim() ?? '';
      if (trimmed) {
        await executeGoalCommand(codexSession, threadId, trimmed);
      }
      codexSession.emitStatusMessage(goalStatusMessage(command.args));
      codexSession.emitCompleted();
      return;
    }
    throw new Error(`Unsupported Codex command: /${command.name}`);
  }

  async getControls(session: ChatProviderSession): Promise<ConversationControls> {
    return buildCodexControls(requireCodexSession(session));
  }

  async setModel(session: ChatProviderSession, modelId: string): Promise<ConversationControls> {
    const codexSession = requireCodexSession(session);
    const models = await codexSession.client.listModels();
    if (models.length > 0 && !models.some((model) => model.id === modelId)) {
      throw new Error(`Unknown Codex model: ${modelId}`);
    }
    codexSession.setModel(modelId);
    return buildCodexControls(codexSession, models);
  }

  async setFeature(
    session: ChatProviderSession,
    featureId: string,
    value: unknown
  ): Promise<ConversationControls> {
    const codexSession = requireCodexSession(session);
    if (featureId !== 'fast_mode') {
      throw new Error(`Unknown Codex feature: ${featureId}`);
    }
    const models = await codexSession.client.listModels();
    const selectedModel = resolveSelectedCodexModel(codexSession, models);
    if (Boolean(value) && !codexModelSupportsFastMode(selectedModel?.id)) {
      throw new Error(
        `Codex fast mode is not available for model '${selectedModel?.id ?? 'default'}'`
      );
    }
    codexSession.setFastMode(Boolean(value));
    return buildCodexControls(codexSession, models);
  }

  private async buildPromptInput(
    codexSession: CodexChatSession,
    text: string
  ): Promise<CodexUserInput[]> {
    const command = parseSlashCommand(text);
    if (!command || command.name === 'compact' || command.name === 'goal') {
      return [toCodexTextInput(text)];
    }

    const customPromptInput = await buildCustomPromptInput(command);
    if (customPromptInput !== undefined) {
      return [toCodexTextInput(customPromptInput)];
    }

    await codexSession.loadSkills();
    const skill = enabledCodexSkills(codexSession.getSkills()).find(
      (candidate) => candidate.name === command.name
    );
    if (skill) {
      return toCodexSkillInput(skill, command.args);
    }

    const fallbackSkills = codexSession.hasAppServerSkillMetadata()
      ? []
      : await listCodexFallbackSkills(codexSession.cwd);
    if (fallbackSkills.some((candidate) => candidate.name === command.name)) {
      return [toCodexTextInput(toCodexSkillPrompt(command.name, command.args))];
    }

    return [toCodexTextInput(text)];
  }

  subscribe(
    session: ChatProviderSession,
    callback: (event: ChatProviderRuntimeEvent) => void
  ): () => void {
    return requireCodexSession(session).subscribe(callback);
  }
}

export const codexChatAdapter = new CodexChatAdapter();

function assertChildWithPipes(
  child: ChildProcess
): asserts child is ChildProcessWithoutNullStreams {
  if (!child.stdin || !child.stdout || !child.stderr) {
    throw new Error('Codex app-server did not expose stdio pipes');
  }
}

async function createCodexClient(
  config: ChatSessionConfig
): Promise<{ client: CodexAppServerClient; goalsEnabled: boolean }> {
  const providerConfig = await providerOverrideSettings.getItem('codex');
  const parsed = parseShellWords(providerConfig?.cli ?? 'codex', { rejectShellSyntax: true });
  if (!parsed.ok || parsed.words.length === 0) {
    throw new Error(parsed.ok ? 'Missing Codex CLI command' : parsed.reason);
  }
  const [command, ...baseArgs] = parsed.words;
  const goalsEnabled = await resolveGoalsEnabled(command, baseArgs);
  const appServerArgs = [
    ...baseArgs,
    'app-server',
    '--listen',
    'stdio://',
    ...(goalsEnabled ? ['--enable', 'goals'] : []),
  ];
  const providerEnv = resolveProviderEnv(providerConfig, {
    providerId: 'codex',
    autoApprove: config.conversation.autoApprove,
  });
  const child = spawn(command, appServerArgs, {
    cwd: config.cwd,
    env: {
      ...buildAgentEnv({
        includeShellVar: true,
        providerVars: {
          ...(providerEnv ?? {}),
          ...(config.env ?? {}),
        },
      }),
    },
    stdio: 'pipe',
  });
  assertChildWithPipes(child);
  child.on('spawn', () => {
    log.info('CodexChatAdapter: started codex app-server', {
      conversationId: config.conversation.id,
    });
  });
  const client = new CodexAppServerClient(new CodexAppServerTransport(child));
  await client.initialize();
  return { client, goalsEnabled };
}

function toCodexTextInput(text: string): CodexUserInput {
  return { type: 'text', text, text_elements: [] };
}

function toCodexSkillInput(skill: CodexSkill, args: string | undefined): CodexUserInput[] {
  return [
    { type: 'skill', name: skill.name, path: skill.path },
    toCodexTextInput(toCodexSkillPrompt(skill.name, args)),
  ];
}

function enabledCodexSkills(skills: CodexSkill[]): CodexSkill[] {
  return skills.filter((skill) => skill.enabled !== false);
}

function toCodexSkillPrompt(name: string, args: string | undefined): string {
  const trimmedArgs = args?.trim() ?? '';
  return trimmedArgs ? `$${name} ${trimmedArgs}` : `$${name}`;
}

function resolveCodexHomeDir(): string {
  return process.env.CODEX_HOME ?? path.join(homedir(), '.codex');
}

function parseFrontMatter(markdown: string): {
  body: string;
  frontMatter: Record<string, string>;
} {
  const lines = markdown.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { body: markdown, frontMatter: {} };
  }
  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === '---') {
      end = index;
      break;
    }
  }
  if (end === -1) {
    return { body: markdown, frontMatter: {} };
  }

  const frontMatter: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf(':');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]/, '')
      .replace(/['"]$/, '');
    if (key && value) {
      frontMatter[key] = value;
    }
  }

  return { body: lines.slice(end + 1).join('\n'), frontMatter };
}

async function listCodexCustomPrompts(): Promise<AgentSlashCommand[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(path.join(resolveCodexHomeDir(), 'prompts'), { withFileTypes: true });
  } catch {
    return [];
  }

  const commands = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== '.md')
      .map(async (entry): Promise<AgentSlashCommand | undefined> => {
        const promptName = entry.name.slice(0, -'.md'.length);
        try {
          const content = await readFile(
            path.join(resolveCodexHomeDir(), 'prompts', entry.name),
            'utf8'
          );
          const { frontMatter } = parseFrontMatter(content);
          return {
            name: `prompts:${promptName}`,
            description: frontMatter.description ?? 'Custom prompt',
            argumentHint: frontMatter['argument-hint'] ?? frontMatter.argument_hint ?? '',
            execution: 'prompt',
          };
        } catch {
          return undefined;
        }
      })
  );
  return commands
    .filter((command): command is AgentSlashCommand => Boolean(command))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function buildCustomPromptInput(
  command: AgentSlashCommandInput
): Promise<string | undefined> {
  if (!command.name.startsWith('prompts:')) return undefined;
  const promptName = command.name.slice('prompts:'.length);
  if (!isSafeCodexPromptName(promptName)) return undefined;
  try {
    const content = await readFile(
      path.join(resolveCodexHomeDir(), 'prompts', `${promptName}.md`),
      {
        encoding: 'utf8',
      }
    );
    return expandCodexCustomPrompt(parseFrontMatter(content).body, command.args);
  } catch {
    return undefined;
  }
}

async function listCodexFallbackSkills(cwd: string): Promise<AgentSlashCommand[]> {
  const candidates = [path.join(cwd, '.codex', 'skills')];
  const repoRoot = await resolveRepoRoot(cwd);
  if (repoRoot) {
    candidates.push(path.join(path.dirname(cwd), '.codex', 'skills'));
    candidates.push(path.join(repoRoot, '.codex', 'skills'));
  }
  candidates.push(path.join(resolveCodexHomeDir(), 'skills'));

  const commandsByName = new Map<string, AgentSlashCommand>();
  for (const dir of candidates) {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      try {
        const content = await readFile(path.join(dir, entry.name, 'SKILL.md'), 'utf8');
        const { frontMatter } = parseFrontMatter(content);
        const name = frontMatter.name;
        const description = frontMatter.description;
        const enabled = frontMatter.enabled?.toLowerCase();
        if (enabled === 'false') continue;
        if (!name || !description || commandsByName.has(name)) continue;
        commandsByName.set(name, { name, description, argumentHint: '', execution: 'prompt' });
      } catch {
        continue;
      }
    }
  }
  return Array.from(commandsByName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function isSafeCodexPromptName(name: string): boolean {
  return (
    Boolean(name) && !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..'
  );
}

async function resolveRepoRoot(cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = execFile(
      'git',
      ['rev-parse', '--show-toplevel'],
      { cwd, timeout: GIT_ROOT_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const root = stdout.trim();
        resolve(root || undefined);
      }
    );
    child.on('error', () => resolve(undefined));
  });
}

function decodeEscapedChar(next: string): string {
  if (next === 'n') return '\n';
  if (next === 't') return '\t';
  return next;
}

function tokenizeCommandArgs(args: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const character = args[index];
    if (quote) {
      if (character === quote) {
        quote = null;
        continue;
      }
      if (character === '\\' && index + 1 < args.length) {
        const next = args[index + 1];
        if (next === quote || next === '\\' || next === 'n' || next === 't') {
          index += 1;
          current += decodeEscapedChar(next);
          continue;
        }
      }
      current += character;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += character;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expandCodexCustomPrompt(template: string, args: string | undefined): string {
  const trimmedArgs = args?.trim() ?? '';
  const tokens = trimmedArgs ? tokenizeCommandArgs(trimmedArgs) : [];
  const named: Record<string, string> = {};
  const positional: string[] = [];

  for (const token of tokens) {
    const separator = token.indexOf('=');
    if (separator > 0) {
      const key = token.slice(0, separator);
      const value = token.slice(separator + 1);
      if (key) {
        named[key] = value;
        continue;
      }
    }
    positional.push(token);
  }

  const dollarPlaceholder = '__CODEX_DOLLAR_PLACEHOLDER__';
  let output = template.split('$$').join(dollarPlaceholder);
  output = output.split('$ARGUMENTS').join(trimmedArgs);
  for (let index = 1; index <= 9; index += 1) {
    output = output.split(`$${index}`).join(positional[index - 1] ?? '');
  }
  for (const key of Object.keys(named).sort((a, b) => b.length - a.length)) {
    output = output.replace(new RegExp(`\\$${escapeRegExp(key)}\\b`, 'g'), named[key] ?? '');
  }
  return output.split(dollarPlaceholder).join('$');
}

function codexPermissionParams(autoApprove: boolean | undefined): {
  approvalPolicy: string;
  sandbox: string;
} {
  if (autoApprove) {
    return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
  }
  return { approvalPolicy: 'on-request', sandbox: 'workspace-write' };
}

function codexTurnPermissionParams(autoApprove: boolean | undefined): {
  approvalPolicy: string;
  sandboxPolicy: CodexSandboxPolicy;
} {
  if (autoApprove) {
    return {
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'dangerFullAccess' },
    };
  }
  return {
    approvalPolicy: 'on-request',
    sandboxPolicy: { type: 'workspaceWrite', networkAccess: false },
  };
}

function requireCodexSession(session: ChatProviderSession): CodexChatSession {
  if (!(session instanceof CodexChatSession)) {
    throw new Error('Invalid Codex chat session');
  }
  return session;
}

function requireThreadId(session: CodexChatSession): string {
  if (!session.providerSessionId) throw new Error('Codex thread is not initialized');
  return session.providerSessionId;
}

function parseSlashCommand(text: string): AgentSlashCommandInput | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/') || trimmed.length <= 1) return undefined;
  const body = trimmed.slice(1);
  const separator = body.search(/\s/);
  const name = separator === -1 ? body : body.slice(0, separator);
  if (!name || name.includes('/')) return undefined;
  const args = separator === -1 ? undefined : body.slice(separator + 1).trim();
  return args ? { name, args } : { name };
}

function mapToolItem(
  notification: Extract<CodexAppServerNotification, { type: 'item' }>,
  fileChangeOutputDeltaByItemId: Map<string, string>,
  execCommandCallIds: Set<string>,
  execCommandInputByCallId: Map<string, { command?: unknown; cwd?: string }>
): AppendConversationTimelineItemInput | undefined {
  if (!notification.itemType || isTextualCodexItemType(notification.itemType)) {
    return undefined;
  }
  if (
    isCommandExecutionItemType(notification.itemType) &&
    execCommandCallIds.has(notification.itemId)
  ) {
    return undefined;
  }
  if (isCommandExecutionItemType(notification.itemType)) {
    return mapCommandExecutionItem(notification, execCommandInputByCallId);
  }
  const bufferedOutput =
    notification.phase === 'completed'
      ? consumeBufferedDelta(fileChangeOutputDeltaByItemId, notification.itemId)
      : undefined;
  return {
    id: notification.itemId,
    kind: 'tool_call',
    payload: {
      toolName: notification.name ?? notification.title ?? notification.itemType,
      status: mapToolStatus(notification.phase, notification.status, notification.error),
      output: notification.output ?? bufferedOutput,
      error: notification.error,
      input: notification.raw,
    },
  };
}

function mapCommandExecutionItem(
  notification: Extract<CodexAppServerNotification, { type: 'item' }>,
  execCommandInputByCallId: Map<string, { command?: unknown; cwd?: string }>
): AppendConversationTimelineItemInput | undefined {
  const item = itemRecordFromRaw(notification.raw);
  const rememberedInput = execCommandInputByCallId.get(notification.itemId);
  const command = commandTextFromValue(item?.command) ?? rememberedInput?.command;
  const cwd = (typeof item?.cwd === 'string' ? item.cwd : undefined) ?? rememberedInput?.cwd;
  const output =
    stringField(item, 'aggregatedOutput') ??
    stringField(item, 'aggregated_output') ??
    notification.output;
  const exitCode = numberField(item, 'exitCode') ?? numberField(item, 'exit_code');
  const error = notification.error;
  return {
    id: notification.itemId,
    kind: 'tool_call',
    payload: {
      toolName: 'shell',
      status:
        error || isFailedExitCode(exitCode)
          ? 'failed'
          : mapToolStatus(notification.phase, notification.status, error),
      input: { command, cwd },
      output,
      error: error ?? (isFailedExitCode(exitCode) ? `Exit code ${exitCode}` : undefined),
    },
  };
}

function mapExecCommandNotification(
  notification: Extract<CodexAppServerNotification, { type: 'exec-command' }>,
  outputDeltaByCallId: Map<string, string>,
  inputByCallId: Map<string, { command?: unknown; cwd?: string }>,
  cwd: string
): AppendConversationTimelineItemInput | undefined {
  const callId = notification.callId ?? `exec:${Date.now()}`;
  const rememberedInput = inputByCallId.get(callId);
  const bufferedOutput =
    notification.phase === 'completed'
      ? consumeBufferedDelta(outputDeltaByCallId, callId)
      : undefined;
  const output = notification.output ?? bufferedOutput;
  const error =
    notification.stderr &&
    (notification.success === false || isFailedExitCode(notification.exitCode))
      ? notification.stderr
      : undefined;
  return {
    id: callId,
    kind: 'tool_call',
    payload: {
      toolName: 'shell',
      status:
        notification.phase === 'started'
          ? 'running'
          : notification.success === false || isFailedExitCode(notification.exitCode)
            ? 'failed'
            : 'completed',
      input: {
        command: notification.command ?? rememberedInput?.command,
        cwd: notification.cwd ?? rememberedInput?.cwd ?? cwd,
      },
      output,
      error:
        error ??
        (isFailedExitCode(notification.exitCode)
          ? `Exit code ${notification.exitCode}`
          : undefined),
    },
  };
}

function mapTerminalInteractionNotification(
  notification: Extract<CodexAppServerNotification, { type: 'terminal-interaction' }>
): AppendConversationTimelineItemInput | undefined {
  const id = notification.processId ?? notification.callId ?? `terminal:${Date.now()}`;
  return {
    id: `terminal:${id}`,
    kind: 'tool_call',
    payload: {
      toolName: 'terminal',
      status: 'completed',
      input: notification.raw,
      output: notification.stdin ? `Input sent to terminal:\n${notification.stdin}` : undefined,
    },
  };
}

function mapPatchApplyNotification(
  notification: Extract<CodexAppServerNotification, { type: 'patch-apply' }>,
  outputDeltaByItemId: Map<string, string>,
  cwd: string
): AppendConversationTimelineItemInput | undefined {
  const callId = notification.callId ?? `patch:${Date.now()}`;
  const bufferedOutput =
    notification.phase === 'completed'
      ? consumeBufferedDelta(outputDeltaByItemId, callId)
      : undefined;
  const output = notification.stdout ?? bufferedOutput;
  return {
    id: callId,
    kind: 'tool_call',
    payload: {
      toolName: 'fileChange',
      status:
        notification.phase === 'started'
          ? 'running'
          : notification.success === false
            ? 'failed'
            : 'completed',
      input: {
        changes: notification.changes,
        cwd,
      },
      output,
      error:
        notification.stderr && notification.success === false ? notification.stderr : undefined,
    },
  };
}

function isTextualCodexItemType(itemType: string): boolean {
  const normalized = itemType.toLowerCase();
  return (
    normalized === 'assistantmessage' ||
    normalized === 'agentmessage' ||
    normalized === 'reasoning' ||
    normalized === 'usermessage'
  );
}

function isCommandExecutionItemType(itemType: string): boolean {
  return itemType.toLowerCase() === 'commandexecution';
}

function hasAuthoritativeExecPayload(
  item: AppendConversationTimelineItemInput | undefined
): boolean {
  if (!item || item.kind !== 'tool_call') return false;
  return item.payload.output !== undefined || item.payload.error !== undefined;
}

function itemRecordFromRaw(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== 'object' || raw === null || !('item' in raw)) return undefined;
  const item = raw.item;
  return typeof item === 'object' && item !== null && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : undefined;
}

function stringField(
  record: Record<string, unknown> | undefined,
  field: string
): string | undefined {
  const value = record?.[field];
  return typeof value === 'string' ? value : undefined;
}

function numberField(
  record: Record<string, unknown> | undefined,
  field: string
): number | undefined {
  const value = record?.[field];
  return typeof value === 'number' ? value : undefined;
}

function commandTextFromValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value.filter((part): part is string => typeof part === 'string');
    return parts.length > 0 ? parts.join(' ') : undefined;
  }
  return undefined;
}

function isFailedExitCode(exitCode: number | null | undefined): boolean {
  return typeof exitCode === 'number' && exitCode !== 0;
}

function mapToolStatus(
  phase: 'started' | 'completed',
  status: string | undefined,
  error: string | undefined
): ConversationToolCallStatus {
  if (error || status === 'failed' || status === 'error') return 'failed';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  if (phase === 'completed' || status === 'completed' || status === 'success') return 'completed';
  return 'running';
}

function renderPlan(plan: Array<{ step?: string; status?: string }>): string {
  const rows = plan
    .map((entry) => {
      const step = entry.step?.trim();
      if (!step) return undefined;
      const status = entry.status?.trim();
      return status ? `- [${status}] ${step}` : `- ${step}`;
    })
    .filter((entry): entry is string => entry !== undefined);
  return rows.length > 0 ? rows.join('\n') : 'Plan updated.';
}

function appendBufferedDelta(
  store: Map<string, string>,
  key: string | undefined,
  delta: string | undefined,
  options: { decodeBase64?: boolean } = {}
): void {
  if (!key || !delta) return;
  const chunk = options.decodeBase64 ? decodeBase64Text(delta) : delta;
  store.set(key, `${store.get(key) ?? ''}${chunk}`);
}

function consumeBufferedDelta(
  store: Map<string, string>,
  key: string | undefined
): string | undefined {
  if (!key) return undefined;
  const value = store.get(key);
  store.delete(key);
  return value;
}

function decodeBase64Text(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return value;
  }
  try {
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    return Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/u, '') ===
      normalized.replace(/=+$/u, '')
      ? decoded
      : value;
  } catch {
    return value;
  }
}

function titleForPermissionRequest(method: string, record: object): string {
  if ('command' in record && typeof record.command === 'string' && record.command.trim()) {
    return `Run command: ${record.command}`;
  }
  if (method === 'item/fileChange/requestApproval') return 'Apply file changes';
  if (method.includes('requestUserInput')) {
    return 'Codex needs input';
  }
  return 'Codex permission request';
}

function bodyForPermissionRequest(record: object): string | undefined {
  if ('reason' in record && typeof record.reason === 'string') return record.reason;
  if ('cwd' in record && typeof record.cwd === 'string') return `Working directory: ${record.cwd}`;
  return undefined;
}

function permissionKindForMethod(method: string): PendingPermission['kind'] {
  if (method.includes('requestUserInput')) return 'question';
  return 'approval';
}

type CodexQuestionInput = {
  questions: Array<{
    id: string;
    header?: string;
    question?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
};

function questionsInputForRequest(record: object): CodexQuestionInput | undefined {
  if (!('questions' in record) || !Array.isArray(record.questions)) return undefined;
  const questions = record.questions
    .map((question): CodexQuestionInput['questions'][number] | undefined => {
      if (typeof question !== 'object' || question === null) return undefined;
      if (!('id' in question) || typeof question.id !== 'string') return undefined;
      const options =
        'options' in question && Array.isArray(question.options)
          ? question.options
              .map((option: unknown): { label: string; description?: string } | undefined => {
                if (typeof option !== 'object' || option === null) return undefined;
                if (!('label' in option) || typeof option.label !== 'string') return undefined;
                const description =
                  'description' in option && typeof option.description === 'string'
                    ? option.description
                    : undefined;
                return { label: option.label, description };
              })
              .filter(
                (
                  option: { label: string; description?: string } | undefined
                ): option is {
                  label: string;
                  description?: string;
                } => option !== undefined
              )
          : undefined;
      const header =
        'header' in question && typeof question.header === 'string' ? question.header : undefined;
      const questionText =
        'question' in question && typeof question.question === 'string'
          ? question.question
          : undefined;
      const multiSelect =
        'multiSelect' in question && typeof question.multiSelect === 'boolean'
          ? question.multiSelect
          : undefined;
      return {
        id: question.id,
        header,
        multiSelect,
        question: questionText,
        options,
      };
    })
    .filter((question): question is CodexQuestionInput['questions'][number] => Boolean(question));
  return questions.length > 0 ? { questions } : undefined;
}

function defaultAnswersForQuestions(
  input: CodexQuestionInput | undefined
): Record<string, { answers: string[] }> {
  if (!input) return {};
  return Object.fromEntries(
    input.questions
      .map((question) => {
        const label = question.options?.map((option) => option.label.trim()).find(Boolean);
        return label ? [question.id, { answers: [label] }] : undefined;
      })
      .filter((entry): entry is [string, { answers: string[] }] => entry !== undefined)
  );
}

function answersForQuestionResponse(
  response: ConversationPermissionResponse,
  fallback: Record<string, { answers: string[] }> | undefined
): Record<string, { answers: string[] }> {
  if (!response.answers || Object.keys(response.answers).length === 0) {
    return fallback ?? {};
  }
  return Object.fromEntries(
    Object.entries(response.answers).map(([id, value]) => [
      id,
      { answers: Array.isArray(value) ? value : [value] },
    ])
  );
}

async function resolveGoalsEnabled(command: string, args: readonly string[]): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileVersion(command, [...args, '--version']);
    return codexVersionAtLeast(`${stdout}\n${stderr}`, CODEX_GOALS_MIN_VERSION);
  } catch (error) {
    log.warn('CodexChatAdapter: failed to resolve Codex version for goals support', {
      error: String(error),
    });
    return false;
  }
}

function execFileVersion(
  command: string,
  args: readonly string[]
): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const childRef: { current?: ReturnType<typeof execFile> } = {};
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      childRef.current?.kill();
      reject(new Error('Codex version check timed out'));
    }, CODEX_VERSION_TIMEOUT_MS);
    timer.unref?.();
    childRef.current = execFile(command, [...args], (error, stdout, stderr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function codexVersionAtLeast(
  versionOutput: string,
  min: readonly [number, number, number]
): boolean {
  const match = versionOutput.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const version: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let i = 0; i < min.length; i += 1) {
    if (version[i] > min[i]) return true;
    if (version[i] < min[i]) return false;
  }
  return true;
}

function goalStatusMessage(args: string | undefined): string {
  const trimmed = args?.trim() ?? '';
  if (!trimmed) return 'Usage: /goal <objective>|pause|resume|clear';
  if (trimmed === 'pause') return 'Goal paused.';
  if (trimmed === 'resume') return 'Goal resumed.';
  if (trimmed === 'clear') return 'Goal cleared.';
  return `Goal set: ${trimmed}`;
}

async function executeGoalCommand(
  session: CodexChatSession,
  threadId: string,
  trimmed: string
): Promise<void> {
  if (trimmed === 'pause') {
    await session.client.setGoal(threadId, { status: 'paused' });
    return;
  }
  if (trimmed === 'resume') {
    await session.client.setGoal(threadId, { status: 'active' });
    return;
  }
  if (trimmed === 'clear') {
    await session.client.clearGoal(threadId);
    return;
  }
  await session.client.setGoal(threadId, { objective: trimmed, status: 'active' });
}

async function buildCodexControls(
  session: CodexChatSession,
  loadedModels?: CodexModel[]
): Promise<ConversationControls> {
  const models = loadedModels ?? (await session.client.listModels());
  const selectedModel = resolveSelectedCodexModel(session, models);
  return {
    ...(selectedModel?.id ? { selectedModelId: selectedModel.id } : {}),
    models: models.map((model) => ({
      id: model.id,
      label: normalizeCodexModelLabel(model.displayName, model.id),
      ...(model.description ? { description: model.description } : {}),
      ...(model.isDefault ? { isDefault: true } : {}),
    })),
    features: codexModelSupportsFastMode(selectedModel?.id)
      ? [
          {
            type: 'toggle',
            id: 'fast_mode',
            label: 'Fast',
            description: 'Priority inference at 2x usage',
            value: session.getServiceTier() === 'fast',
          },
        ]
      : [],
  };
}

function resolveSelectedCodexModel(
  session: CodexChatSession,
  models: CodexModel[]
): CodexModel | undefined {
  const configuredModel = session.getModel();
  return (
    (configuredModel ? models.find((model) => model.id === configuredModel) : undefined) ??
    models.find((model) => model.isDefault) ??
    models[0]
  );
}

function normalizeCodexModelLabel(displayName: string | undefined, id: string): string {
  const normalized = displayName?.trim();
  if (!normalized) return id;
  return normalized;
}

function codexModelSupportsFastMode(modelId: string | null | undefined): boolean {
  const normalized = modelId?.trim();
  if (!normalized) return false;
  return CODEX_FAST_MODE_SUPPORTED_MODEL_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix)
  );
}
