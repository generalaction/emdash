import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionModeState,
  SetSessionConfigOptionRequest,
  SetSessionModeRequest,
} from '@agentclientprotocol/sdk';
import type { Result } from '@emdash/shared';
import { ok, toSerializedError } from '@emdash/shared';
import type { AcpRuntimeError } from '../errors';
import { acpErr } from '../errors';
import {
  type Command,
  type DomainEvent,
  type Effect,
  SessionMachine,
  type SessionMachineContext,
} from '../machine/machine';
import type { SessionConfigState, SessionUsage } from '../models/config';
import type { AcpPermissionRequest } from '../models/permissions';
import { SESSION_PLAN_ID } from '../models/plan';
import type { PromptDraft, PromptDraftUpdate, PromptInput, QueuedPrompt } from '../models/prompt';
import type { SessionState, StopReason } from '../models/session';
import type {
  ToolCallItem,
  ToolNode,
  TranscriptTurn,
  TranscriptTurnOutcome,
} from '../models/turns';
import { makeToolId } from '../reducer/ids';
import { createToolCallItem } from '../reducer/item-fold';
import type { NormalizedEvent } from '../reducer/normalized-event';
import { AcpTranscriptParser } from '../reducer/parser';
import type { SessionCellDeps, SessionPromptResult } from './cell-deps';
import { PermissionBroker } from './permission-broker';
import { RawAcpLog, type RawAcpEvent } from './raw-log';

export interface AcpChatHistory {
  committed: TranscriptTurn[];
  active: TranscriptTurn | null;
}

type ConfigDimension = 'model' | 'effort';

export class SessionCell {
  readonly machine: SessionMachine;
  readonly transcript: AcpTranscriptParser;
  readonly rawLog: RawAcpLog;
  private readonly permissions = new PermissionBroker();
  private _acpSessionId: string;
  private quiesceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRunningAgentCount = 0;
  private effectQueue: Effect[] = [];
  private interpretingEffects = false;
  private draft: PromptDraft | null = null;
  private draftRev = 0;

  constructor(private readonly deps: SessionCellDeps) {
    this._acpSessionId = deps.acpSessionId;
    this.machine = new SessionMachine(deps.conversationId);
    this.transcript = new AcpTranscriptParser({ conversationId: deps.conversationId });
    this.rawLog = new RawAcpLog({
      conversationId: deps.conversationId,
      providerId: deps.providerId,
      acpSessionId: deps.acpSessionId,
      createdAt: new Date().toISOString(),
    });
  }

  get conversationId(): string {
    return this.deps.conversationId;
  }

  get acpSessionId(): string {
    return this._acpSessionId;
  }

  setAcpSessionId(sessionId: string): void {
    this._acpSessionId = sessionId;
    this.rawLog.setAcpSessionId(sessionId);
  }

  get sessionState(): SessionState {
    return this.machine.sessionState();
  }

  get promptDraft(): PromptDraft | null {
    return this.draft ? structuredClone(this.draft) : null;
  }

  get config(): SessionConfigState {
    return this.transcript.config;
  }

  get usage(): SessionUsage | null {
    return this.transcript.usage;
  }

  history(): AcpChatHistory {
    return {
      committed: structuredClone([...this.transcript.history]),
      active: this.transcript.activeTurn ? structuredClone(this.transcript.activeTurn) : null,
    };
  }

  exportParsedTranscript(): string {
    const history = this.history();
    return JSON.stringify(
      {
        meta: {
          conversationId: this.conversationId,
          providerId: this.deps.providerId,
          acpSessionId: this.acpSessionId,
          exportedAt: new Date().toISOString(),
        },
        committed: history.committed,
        active: history.active,
      },
      null,
      2
    );
  }

  recordRaw(event: RawAcpEvent): void {
    this.rawLog.record(event);
  }

  exportRawLog(): string {
    return this.rawLog.exportJson();
  }

  beginReplay(at = Date.now()): void {
    this.applyEvent({ type: 'ReplayStarted' });
    this.transcript.beginReplay(at);
    this.lastRunningAgentCount = 0;
  }

  endReplay(at = Date.now()): void {
    const previousRunningAgentCount = this.lastRunningAgentCount;
    this.transcript.endReplay(at);
    this.dispatchAgentsChangedIfNeeded(previousRunningAgentCount);
    this.applyEvent({ type: 'ReplayEnded', status: 'complete' });
    this.emitTranscriptChanged();
  }

  applySessionReady(meta?: {
    modes?: SessionModeState | null;
    configOptions?: readonly SessionConfigOption[] | null;
  }): void {
    this.applyEvent({ type: 'SessionReady' });
    this.seedTranscriptMeta(meta);
  }

  applySessionLoaded(meta?: {
    modes?: SessionModeState | null;
    configOptions?: readonly SessionConfigOption[] | null;
  }): void {
    this.applyEvent({ type: 'SessionLoaded' });
    this.seedTranscriptMeta(meta);
  }

  applySessionMeta(meta: {
    modes?: SessionModeState | null;
    configOptions?: readonly SessionConfigOption[] | null;
  }): void {
    this.seedTranscriptMeta(meta);
  }

  push(event: NormalizedEvent): void {
    if (event.kind === 'ignored') return;

    const idleTranscriptEvent = this.isIdleAgentTranscriptEvent(event);
    if (idleTranscriptEvent) this.applyEvent({ type: 'AgentActivity', active: true });

    if (this.isTranscriptEvent(event) && !this.canAcceptTranscriptEvent()) {
      this.deps.logger.warn('SessionCell: dropping transcript update outside active turn', {
        conversationId: this.conversationId,
        phase: this.machine.phase.kind,
      });
      return;
    }

    const previousRunningAgentCount = this.lastRunningAgentCount;
    this.transcript.pushEvent(event);
    this.dispatchAgentsChangedIfNeeded(previousRunningAgentCount);
    if (idleTranscriptEvent) this.scheduleQuiesce();
    this.emitTranscriptChanged();
  }

  async prompt(input: PromptInput): Promise<Result<SessionPromptResult, AcpRuntimeError>> {
    const now = Date.now();
    const result = await this.sendPromptInternal({
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    if (result.success) this.clearDraft();
    return result;
  }

  queuePrompt(input: PromptInput): Result<void, AcpRuntimeError> {
    const now = Date.now();
    const result = this.dispatch({
      type: 'QueuePrompt',
      prompt: {
        id: crypto.randomUUID(),
        ...input,
        createdAt: now,
        updatedAt: now,
      },
    });
    if (!result.success) return result;
    this.clearDraft();
    return ok();
  }

  setPromptDraft(update: PromptDraftUpdate): Result<void, AcpRuntimeError> {
    if (update.rev <= this.draftRev) return ok();
    this.draftRev = update.rev;

    if (update.input === null) {
      if (this.draft !== null) {
        this.draft = null;
        this.deps.callbacks?.onDraftChanged?.();
      }
      return ok();
    }

    this.draft = { ...update.input, rev: update.rev, updatedAt: Date.now() };
    this.deps.callbacks?.onDraftChanged?.();
    return ok();
  }

  editQueuedPrompt(id: string, input: PromptInput): Result<void, AcpRuntimeError> {
    const result = this.dispatch({
      type: 'EditQueuedPrompt',
      id,
      input,
      updatedAt: Date.now(),
    });
    if (!result.success) return result;
    return ok();
  }

  removeQueuedPrompt(id: string): Result<void, AcpRuntimeError> {
    const result = this.dispatch({ type: 'RemoveQueuedPrompt', id });
    if (!result.success) return result;
    return ok();
  }

  reorderQueue(ids: readonly string[]): Result<void, AcpRuntimeError> {
    const result = this.dispatch({ type: 'ReorderQueue', ids });
    if (!result.success) return result;
    return ok();
  }

  async cancel(): Promise<Result<void, AcpRuntimeError>> {
    const dispatchResult = this.dispatch({ type: 'Cancel' });
    if (!dispatchResult.success) return dispatchResult;
    try {
      await this.deps.agent.cancel({ sessionId: this.acpSessionId });
      return ok();
    } catch (e) {
      return acpErr.cancelFailed(toSerializedError(e));
    }
  }

  async closeSession(): Promise<void> {
    if (!this.deps.agent.closeSession) return;
    await this.deps.agent.closeSession({ sessionId: this.acpSessionId });
  }

  resolvePermission(requestId: string, optionId: string): Result<void, AcpRuntimeError> {
    if (!this.machine.pendingPermissions.some((p) => p.requestId === requestId)) {
      return acpErr.invalidState(`No resolver for requestId '${requestId}'`);
    }
    const dispatchResult = this.dispatch({ type: 'ResolvePermission', requestId, optionId });
    if (!dispatchResult.success) return dispatchResult;
    this.rawLog.record({
      kind: 'permission_resolved',
      sessionId: this.acpSessionId,
      requestId,
      optionId,
    });
    this.permissions.settle(requestId, optionId);
    return ok();
  }

  requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const requestId = crypto.randomUUID();
    const request: AcpPermissionRequest = {
      requestId,
      toolCall: this.buildPermissionToolCall(requestId, params.toolCall),
      options: params.options.map((option) => ({
        optionId: option.optionId,
        name: option.name,
        kind: option.kind,
      })),
    };
    this.rawLog.record({
      kind: 'permission_request',
      sessionId: params.sessionId,
      request: params,
    });
    this.applyEvent({ type: 'PermissionRequested', request });
    return this.permissions.request(request);
  }

  async setMode(modeId: string): Promise<Result<void, AcpRuntimeError>> {
    const result = this.dispatch({ type: 'SetMode', modeId });
    if (!result.success) return result;
    const configId = this.transcript.config.modeOptions?.configId ?? null;
    if (configId && this.deps.agent.setSessionConfigOption) {
      try {
        const response = await this.deps.agent.setSessionConfigOption({
          sessionId: this.acpSessionId,
          configId,
          value: modeId,
        } satisfies SetSessionConfigOptionRequest);
        this.seedTranscriptMeta({ configOptions: response.configOptions });
        return ok();
      } catch (e) {
        return acpErr.setModeFailed(toSerializedError(e));
      }
    }
    if (!this.deps.agent.setSessionMode) {
      return acpErr.setModeFailed({
        name: 'Error',
        message: 'Agent connection does not support setSessionMode',
      });
    }
    try {
      await this.deps.agent.setSessionMode({
        sessionId: this.acpSessionId,
        modeId,
      } satisfies SetSessionModeRequest);
      return ok();
    } catch (e) {
      return acpErr.setModeFailed(toSerializedError(e));
    }
  }

  async setConfigOption(
    dimension: ConfigDimension,
    value: string
  ): Promise<Result<void, AcpRuntimeError>> {
    const configId = this.configIdForDimension(dimension);
    if (!configId) {
      return acpErr.setConfigFailed({
        name: 'Error',
        message: `Agent connection does not expose ${dimension} configuration`,
      });
    }
    const result = this.dispatch({ type: 'SetConfigOption', configId, value });
    if (!result.success) return result;
    if (!this.deps.agent.setSessionConfigOption) return ok();
    try {
      const response = await this.deps.agent.setSessionConfigOption({
        sessionId: this.acpSessionId,
        configId,
        value,
      } satisfies SetSessionConfigOptionRequest);
      this.seedTranscriptMeta({ configOptions: response.configOptions });
      return ok();
    } catch (e) {
      return acpErr.setConfigFailed(toSerializedError(e));
    }
  }

  settleTurn(outcome: TranscriptTurnOutcome): void {
    const previousRunningAgentCount = this.lastRunningAgentCount;
    this.transcript.settleTurn(outcome);
    this.dispatchAgentsChangedIfNeeded(previousRunningAgentCount);
    this.emitTranscriptChanged();
    this.applyEvent({ type: 'TurnEnded', outcome: machineOutcome(outcome) });
  }

  processClosed(exitCode: number | null): void {
    this.clearQuiesce();
    this.applyEvent({ type: 'ProcessClosed', exitCode });
  }

  dispose(): void {
    this.clearQuiesce();
    this.permissions.drain(this.machine.pendingPermissions);
  }

  private dispatch(command: Command): Result<Effect[], AcpRuntimeError> {
    const result = this.machine.dispatch(command, this.context());
    if (!result.success) return result;
    this.interpretEffects(result.data);
    return result;
  }

  private applyEvent(event: DomainEvent): void {
    this.interpretEffects(this.machine.apply(event));
  }

  private interpretEffects(effects: Effect[]): void {
    this.effectQueue.push(...effects);
    if (this.interpretingEffects) return;

    this.interpretingEffects = true;
    let stateChanged = false;
    try {
      while (this.effectQueue.length > 0) {
        const effect = this.effectQueue.shift()!;
        switch (effect.type) {
          case 'state':
          case 'permissionRequest':
            stateChanged = true;
            break;
          case 'permissionResolved':
            stateChanged = true;
            if (effect.cancelled) this.permissions.cancel(effect.requestId);
            break;
          case 'closed':
            this.deps.callbacks?.onClosed?.(effect.exitCode);
            break;
          case 'agentEvent':
            this.deps.callbacks?.onAgentEvent?.(effect.phase);
            break;
          case 'settleAgents':
            this.settleRunningAgents(effect.scope, effect.status);
            break;
          case 'sendPrompt':
            this.deps.callbacks?.onSendQueuedPrompt?.(effect.prompt);
            void this.sendPromptInternal(effect.prompt).then((result) => {
              if (!result.success) {
                this.deps.logger.warn('SessionCell: failed to send queued prompt', {
                  conversationId: this.conversationId,
                  error: result.error,
                });
              }
            });
            break;
          case 'warn':
            this.deps.logger.warn(`SessionCell: ${effect.message}`, {
              conversationId: this.conversationId,
            });
            break;
        }
      }
    } finally {
      this.interpretingEffects = false;
    }
    if (stateChanged) this.deps.callbacks?.onSessionStateChanged?.();
  }

  private async sendPromptInternal(
    prompt: QueuedPrompt
  ): Promise<Result<SessionPromptResult, AcpRuntimeError>> {
    const decision = this.dispatch({ type: 'Prompt', prompt });
    if (!decision.success) return decision;
    const started = decision.data.some(
      (effect) => effect.type === 'agentEvent' && effect.phase === 'start'
    );
    if (!started) return ok({ queued: true });

    const messageId = `${this.conversationId}-${this.machine.nextTurnIndex}-user`;
    this.transcript.pushEvent({
      kind: 'message',
      role: 'user',
      messageId,
      text: prompt.text,
      ...(prompt.attachments?.length
        ? {
            attachments: prompt.attachments.map((attachment, index) => ({
              id: attachment.type === 'attachment' ? attachment.id : `${messageId}-image-${index}`,
              name: attachment.name ?? `image-${index + 1}`,
              mimeType: attachment.mimeType,
            })),
          }
        : {}),
    });
    this.emitTranscriptChanged();

    try {
      const resolvedAttachments = await Promise.all(
        (prompt.attachments ?? []).map((attachment) => this.deps.resolveAttachment(attachment))
      );
      const promptRequest = {
        sessionId: this.acpSessionId,
        prompt: [
          ...resolvedAttachments.map((attachment) => ({
            type: 'image' as const,
            data: attachment.data,
            mimeType: attachment.mimeType,
          })),
          ...(prompt.text ? [{ type: 'text' as const, text: prompt.text }] : []),
          ...(prompt.hiddenContext ? [{ type: 'text' as const, text: prompt.hiddenContext }] : []),
        ],
      };
      this.rawLog.record({
        kind: 'prompt',
        sessionId: this.acpSessionId,
        content: promptRequest.prompt,
      });
      const response = await this.deps.agent.prompt(promptRequest);
      this.rawLog.record({
        kind: 'prompt_result',
        sessionId: this.acpSessionId,
        stopReason: response.stopReason,
      });
      this.settleTurn(outcomeFromStopReason(response.stopReason));
      return ok({ queued: false });
    } catch (e) {
      const err = acpErr.promptFailed(toSerializedError(e));
      this.rawLog.record({
        kind: 'prompt_result',
        sessionId: this.acpSessionId,
        stopReason: null,
      });
      this.settleTurn({ kind: 'error', reason: 'prompt_failed' });
      return err;
    }
  }

  private seedTranscriptMeta(meta?: {
    modes?: SessionModeState | null;
    configOptions?: readonly SessionConfigOption[] | null;
  }): void {
    if (!meta) return;
    if (meta.configOptions !== undefined) {
      this.transcript.pushEvent({
        kind: 'config',
        options: meta.configOptions ?? [],
      });
    }
    if (meta.modes?.currentModeId) {
      this.transcript.pushEvent({
        kind: 'mode_selected',
        modeId: meta.modes.currentModeId,
      });
    }
    if (meta.configOptions !== undefined || meta.modes?.currentModeId) {
      this.emitTranscriptChanged();
    }
  }

  private dispatchAgentsChangedIfNeeded(previousRunningAgentCount: number): void {
    const nextRunningAgentCount = this.transcript.agents.filter(
      (agent) => agent.background === true && agent.status === 'running'
    ).length;
    if (nextRunningAgentCount === previousRunningAgentCount) return;
    this.lastRunningAgentCount = nextRunningAgentCount;
    this.applyEvent({ type: 'AgentsChanged', runningCount: nextRunningAgentCount });
  }

  private settleRunningAgents(scope: 'turn' | 'all', status: 'completed' | 'failed'): void {
    const runningAgents = this.transcript.agents.filter((agent) => {
      if (agent.status !== 'running') return false;
      return scope === 'all' || agent.background !== true;
    });

    for (const agent of runningAgents) {
      this.push({
        kind: 'subagent_update',
        agentId: agent.agentId,
        toolCallId: agent.toolCallId,
        status,
      });
    }
  }

  private clearDraft(): void {
    this.draftRev += 1;
    if (this.draft === null) return;
    this.draft = null;
    this.deps.callbacks?.onDraftChanged?.();
  }

  private scheduleQuiesce(): void {
    if (this.quiesceTimer) clearTimeout(this.quiesceTimer);
    this.quiesceTimer = setTimeout(() => {
      this.quiesceTimer = null;
      if (!this.machine.agentTurnActive) return;
      this.transcript.settleTurn({ kind: 'done', reason: 'quiesced' });
      this.emitTranscriptChanged();
      this.applyEvent({ type: 'AgentActivity', active: false });
    }, 250);
  }

  private clearQuiesce(): void {
    if (!this.quiesceTimer) return;
    clearTimeout(this.quiesceTimer);
    this.quiesceTimer = null;
  }

  private context(): SessionMachineContext {
    return {
      modeIds: this.transcript.config.modeOptions?.available.map((mode) => mode.id) ?? [],
      configOptionIds: [
        ...(this.transcript.config.modelOptions
          ? [this.transcript.config.modelOptions.configId]
          : []),
        ...(this.transcript.config.efforts ? [this.transcript.config.efforts.configId] : []),
      ],
    };
  }

  private configIdForDimension(dimension: ConfigDimension): string | null {
    switch (dimension) {
      case 'model':
        return this.transcript.config.modelOptions?.configId ?? null;
      case 'effort':
        return this.transcript.config.efforts?.configId ?? null;
    }
  }

  private isTranscriptEvent(event: NormalizedEvent): boolean {
    switch (event.kind) {
      case 'message':
      case 'thinking':
      case 'tool_call':
      case 'tool_update':
      case 'subagent':
      case 'search':
      case 'mcp_tool':
      case 'web_fetch':
      case 'plan':
        return true;
      default:
        return false;
    }
  }

  private isIdleAgentTranscriptEvent(event: NormalizedEvent): boolean {
    return (
      this.machine.phase.kind === 'ready' &&
      this.isTranscriptEvent(event) &&
      !(event.kind === 'message' && event.role === 'user')
    );
  }

  private canAcceptTranscriptEvent(): boolean {
    return (
      this.machine.phase.kind === 'working' ||
      this.machine.phase.kind === 'replaying' ||
      this.machine.phase.kind === 'ready' ||
      this.machine.agentTurnActive
    );
  }

  private buildPermissionToolCall(
    requestId: string,
    rawToolCall: RequestPermissionRequest['toolCall'] | undefined
  ): ToolCallItem {
    const activeTurn = this.transcript.activeTurn;
    const toolCallId = rawToolCall?.toolCallId ?? requestId;
    if (activeTurn) {
      const id = makeToolId(activeTurn.id, toolCallId);
      const existing = findToolCall(activeTurn.items, id, toolCallId);
      if (existing) return structuredClone(existing);
    }

    return createToolCallItem({
      id: activeTurn ? makeToolId(activeTurn.id, toolCallId) : `permission:${toolCallId}`,
      seq: 0,
      toolCallId,
      title: rawToolCall?.title ?? 'Permission request',
      toolKind: rawToolCall?.kind ?? null,
      status: 'pending',
      parentToolCallId: undefined,
    });
  }

  private emitTranscriptChanged(): void {
    this.deps.callbacks?.onTranscriptChanged?.();
  }
}

function findToolCall(
  items: Array<ToolNode | { kind: string; id: string }>,
  id: string,
  toolCallId: string
): ToolCallItem | undefined {
  for (const item of items) {
    if (item.kind.endsWith('-tool-call') && 'toolCallId' in item) {
      if (item.id === id || item.toolCallId === toolCallId) return item as ToolCallItem;
      const found = findToolCall((item as ToolCallItem).children ?? [], id, toolCallId);
      if (found) return found;
    } else if (item.kind === 'tool-group' && 'children' in item) {
      const found = findToolCall(item.children as ToolNode[], id, toolCallId);
      if (found) return found;
    }
  }
  return undefined;
}

function machineOutcome(
  outcome: TranscriptTurnOutcome
): { kind: 'stopped'; stopReason: StopReason } | { kind: 'errored' } {
  if (outcome.kind === 'error') return { kind: 'errored' };
  if (outcome.kind === 'cancelled') return { kind: 'stopped', stopReason: 'cancelled' };
  return { kind: 'stopped', stopReason: toStopReason(outcome.reason) };
}

function outcomeFromStopReason(stopReason: StopReason): TranscriptTurnOutcome {
  if (stopReason === 'cancelled') return { kind: 'cancelled', reason: stopReason };
  return { kind: 'done', reason: stopReason };
}

function toStopReason(reason: TranscriptTurnOutcome['reason']): StopReason {
  switch (reason) {
    case 'cancelled':
    case 'end_turn':
    case 'max_tokens':
    case 'max_turn_requests':
    case 'refusal':
      return reason;
    default:
      return 'end_turn';
  }
}

export { SESSION_PLAN_ID };
