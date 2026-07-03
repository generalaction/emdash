import type {
  Client,
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  LoadSessionRequest,
  NewSessionRequest,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionModeState,
  SessionNotification,
  SessionUpdate,
  SetSessionConfigOptionRequest,
  SetSessionModeRequest,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { Result } from '@emdash/shared';
import { isErr, LifecycleMap, ok, toSerializedError } from '@emdash/shared';
import type { AcpAgentApi, IAcpBehavior } from '../agents/plugins/capabilities/acp';
import { createAcpAgentConnection } from './acp-agent-connection';
import { AgentTerminalManager } from './agent-terminal-manager';
import { FsPort, TerminalPort } from './client-ports';
import type { AcpRuntimeError } from './errors';
import { acpErr } from './errors';
import type { AcpPermissionRequest } from './models/permissions';
import type { PromptInput, QueuedPrompt } from './models/prompt';
import type { SessionState, StopReason } from './models/session';
import type { TerminalState } from './models/terminals';
import type { TranscriptState, TranscriptTurnOutcome } from './models/transcript';
import { PermissionBroker } from './permission-broker';
import type { NormalizedEvent } from './reducer/normalized-event';
import { AcpTranscriptParser } from './reducer/parser';
import type { AcpSessionRuntimeDeps, AcpStartInput, IAcpSessionRuntime } from './runtime';
import { SessionMachine } from './session-machine';
import type { Command, DomainEvent, Effect } from './session-machine';
import type { AcpProcessHandle } from './transport';

interface AcpConversation {
  conversationId: string;
  projectId: string;
  taskId: string;
  providerId: string;
  acpSessionId: string | null;
  machine: SessionMachine;
  transcript: AcpTranscriptParser;
  agentTurnQuiesceTimer: ReturnType<typeof setTimeout> | null;
  lastRunningAgentCount: number;
}

interface AcpAgentProcess {
  handle: AcpProcessHandle;
  agent: AcpAgentApi;
  /**
   * Converts a raw ACP `SessionUpdate` into a normalized transcript event.
   * Composed of baseline decode plus the optional provider `enrich` hook.
   */
  normalize: (raw: SessionUpdate) => NormalizedEvent;
  providerId: string;
  workspaceId: string;
  cwd: string;
  /** All conversations currently multiplexed on this connection. */
  conversations: Map<string, AcpConversation>;
  /** Maps ACP sessionId → conversationId for routing incoming events. */
  sessionToConversation: Map<string, string>;
  /** Conversations currently awaiting loadSession so unknown-sessionId notifications can be routed. */
  loadingConversations: Set<string>;
  /** Whether the agent advertised loadSession support during initialize. */
  supportsLoadSession: boolean;
}

/**
 * Machine-agnostic ACP session engine.
 */
export class AcpSessionRuntime implements IAcpSessionRuntime {
  private readonly deps: Required<AcpSessionRuntimeDeps>;
  private readonly terminals: AgentTerminalManager;
  private readonly fsPort: FsPort;
  private readonly terminalPort: TerminalPort;
  private readonly processes = new LifecycleMap<AcpAgentProcess, AcpRuntimeError, void>();
  private conversationIndex = new Map<
    string,
    { processKey: string; acpSessionId: string | null }
  >();
  private readonly permissionBroker = new PermissionBroker();

  constructor(deps: AcpSessionRuntimeDeps) {
    this.deps = { ...deps };
    this.terminals = new AgentTerminalManager(this.deps.host, this.deps.listener);
    this.fsPort = new FsPort(this.deps.host);
    this.terminalPort = new TerminalPort(this.terminals);
  }

  async start(input: AcpStartInput): Promise<Result<void, AcpRuntimeError>> {
    const { conversationId, providerId, workspaceId, cwd, sessionId, model, initialPrompt } = input;

    if (this.conversationIndex.has(conversationId)) {
      this.deps.logger.debug('AcpSessionRuntime: conversation already running', { conversationId });
      const conv = this.resolveConv(conversationId);
      if (conv) this.emitSnapshot(conv);
      return ok();
    }

    const binding = this.deps.resolveAcp(providerId);
    if (!binding) {
      return acpErr.providerUnsupported(providerId);
    }

    // Reserve a slot synchronously before the first await so concurrent start()
    // calls cannot both proceed past the has() guard above.
    const processKey = `${providerId}:${workspaceId}`;
    this.conversationIndex.set(conversationId, { processKey, acpSessionId: null });

    const procResult = await this.processes.provision(processKey, () =>
      this.provisionProcess(processKey, providerId, workspaceId, cwd, binding)
    );
    if (isErr(procResult)) {
      this.conversationIndex.delete(conversationId);
      return procResult;
    }
    const proc = procResult.data;

    const conv: AcpConversation = {
      conversationId,
      projectId: input.projectId,
      taskId: input.taskId,
      providerId,
      acpSessionId: sessionId,
      machine: new SessionMachine(conversationId),
      transcript: new AcpTranscriptParser({ conversationId, enrich: binding.behavior.enrich }),
      agentTurnQuiesceTimer: null,
      lastRunningAgentCount: 0,
    };

    proc.conversations.set(conversationId, conv);
    this.conversationIndex.set(conversationId, { processKey, acpSessionId: conv.acpSessionId });

    // Emit initial 'starting' snapshot
    this.emitSnapshot(conv);

    try {
      // Assigned in all success paths; TypeScript needs the initializer for control flow
      let acpSessionId = '';
      // True only when a fresh newSession was started (not a loadSession resume).
      // The creation-time model is re-applied only on fresh sessions so that a
      // resumed session can trust the agent's authoritative configOptions instead.
      let establishedViaNewSession = false;

      if (conv.acpSessionId && proc.supportsLoadSession && proc.agent.loadSession) {
        const originalSessionId = conv.acpSessionId;
        proc.sessionToConversation.set(originalSessionId, conversationId);
        proc.loadingConversations.add(conversationId);

        // Open replay turn
        this.applyEvent(conv, { type: 'ReplayStarted' });
        conv.transcript.beginReplay();
        conv.lastRunningAgentCount = 0;

        let loadedSuccessfully = false;
        try {
          const resp = await proc.agent.loadSession!(
            this.buildLoadSessionRequest(cwd, originalSessionId)
          );
          proc.loadingConversations.delete(conversationId);
          // Seed metadata from loadSession response
          if (resp.modes !== undefined || resp.configOptions !== undefined) {
            this.applyEvent(conv, {
              type: 'SessionLoaded',
              modes: resp.modes,
              configOptions: resp.configOptions,
            });
            this.seedTranscriptMeta(conv, {
              modes: resp.modes,
              configOptions: resp.configOptions,
            });
          }
          conv.transcript.endReplay();
          this.emitTranscript(conv);
          this.applyEvent(conv, { type: 'ReplayEnded', status: 'complete' });
          acpSessionId = conv.acpSessionId!;
          if (acpSessionId !== originalSessionId) {
            proc.sessionToConversation.delete(originalSessionId);
          }
          loadedSuccessfully = true;
        } catch {
          proc.loadingConversations.delete(conversationId);
        }

        if (!loadedSuccessfully) {
          this.deps.logger.warn('AcpSessionRuntime: loadSession failed, starting new session', {
            conversationId,
          });
          // Commit the replay turn as 'complete' even on failure: the session continues
          // with a fresh newSession, so the empty replay turn is not an error from the
          // user's perspective.
          conv.transcript.endReplay();
          this.emitTranscript(conv);
          this.applyEvent(conv, { type: 'ReplayEnded', status: 'complete' });
          proc.sessionToConversation.delete(originalSessionId);
          if (conv.acpSessionId !== originalSessionId) {
            proc.sessionToConversation.delete(conv.acpSessionId!);
          }

          try {
            const newResp = await proc.agent.newSession(this.buildNewSessionRequest(cwd));
            acpSessionId = newResp.sessionId;
            establishedViaNewSession = true;
            this.applyEvent(conv, {
              type: 'SessionReady',
              modes: newResp.modes,
              configOptions: newResp.configOptions,
            });
            this.seedTranscriptMeta(conv, {
              modes: newResp.modes,
              configOptions: newResp.configOptions,
            });
          } catch (e) {
            this.cleanupFailedConversation(processKey, proc, conv);
            return acpErr.newSessionFailed(toSerializedError(e));
          }
        }
      } else {
        // No existing session id, or loadSession not supported — start fresh
        try {
          const newResp = await proc.agent.newSession(this.buildNewSessionRequest(cwd));
          acpSessionId = newResp.sessionId;
          establishedViaNewSession = true;
          this.applyEvent(conv, {
            type: 'SessionReady',
            modes: newResp.modes,
            configOptions: newResp.configOptions,
          });
          this.seedTranscriptMeta(conv, {
            modes: newResp.modes,
            configOptions: newResp.configOptions,
          });
        } catch (e) {
          this.cleanupFailedConversation(processKey, proc, conv);
          return acpErr.newSessionFailed(toSerializedError(e));
        }
      }

      conv.acpSessionId = acpSessionId;
      proc.sessionToConversation.set(acpSessionId, conversationId);
      this.conversationIndex.set(conversationId, { processKey, acpSessionId });

      void this.deps
        .persistSessionId(conversationId, acpSessionId)
        .then((result) => {
          if (!result.success) {
            this.deps.logger.warn('AcpSessionRuntime: failed to persist session id', {
              conversationId,
              error: result.error.type,
            });
          }
        })
        .catch(() => {});

      // Re-apply the creation-time model only for fresh sessions. Resumed sessions
      // trust the agent's authoritative configOptions from loadSession instead.
      if (establishedViaNewSession && model && proc.agent.setSessionConfigOption) {
        await this.applyConfigOptionInternal(proc.agent, acpSessionId, 'model', model, conv);
      }

      if (initialPrompt?.trim()) {
        const now = Date.now();
        const promptResult = await this.sendPromptInternal(proc, conv, {
          id: crypto.randomUUID(),
          text: initialPrompt,
          createdAt: now,
          updatedAt: now,
        });
        if (!promptResult.success) {
          this.deps.logger.warn('AcpSessionRuntime: initial prompt failed', {
            conversationId,
            error: promptResult.error.type,
          });
        }
      }

      return ok();
    } catch (err) {
      this.deps.logger.error('AcpSessionRuntime: unexpected error during start', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.cleanupFailedConversation(processKey, proc, conv);
      return acpErr.initializeFailed(toSerializedError(err));
    }
  }

  async prompt(
    conversationId: string,
    input: PromptInput
  ): Promise<Result<void, AcpRuntimeError>> {
    const conv = this.resolveConv(conversationId);
    if (!conv) return acpErr.conversationNotFound(conversationId);
    const entry = this.conversationIndex.get(conversationId);
    if (!entry?.acpSessionId) return acpErr.noActiveSession(conversationId);
    const proc = this.processes.get(entry.processKey);
    if (!proc) return acpErr.noActiveSession(conversationId);
    const now = Date.now();
    return this.sendPromptInternal(proc, conv, {
      id: crypto.randomUUID(),
      ...input,
      createdAt: now,
      updatedAt: now,
    });
  }

  async cancel(conversationId: string): Promise<Result<void, AcpRuntimeError>> {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry?.acpSessionId) return ok();
    const proc = this.processes.get(entry.processKey);
    if (!proc) return ok();
    const conv = proc.conversations.get(conversationId);
    if (!conv) return ok();

    // Dispatch Cancel command — drains permissions, flips to cancelling
    const dispatchResult = this.dispatch(conv, { type: 'Cancel' });
    if (!dispatchResult.success) return dispatchResult;

    try {
      await proc.agent.cancel({ sessionId: entry.acpSessionId! });
    } catch (e) {
      const err = acpErr.cancelFailed(toSerializedError(e));
      this.deps.logger.warn('AcpSessionRuntime: cancel failed', {
        conversationId,
        error: err.error.type,
      });
      return err;
    }
    return ok();
  }

  resolvePermission(
    conversationId: string,
    requestId: string,
    optionId: string | null
  ): Result<void, AcpRuntimeError> {
    const conv = this.resolveConv(conversationId);
    if (!conv) return acpErr.conversationNotFound(conversationId);

    const pending = conv.machine.pendingPermissions.some((p) => p.requestId === requestId);
    if (!pending) {
      this.deps.logger.warn('AcpSessionRuntime: resolvePermission for unknown requestId', {
        conversationId,
        requestId,
      });
      return acpErr.invalidState(`No resolver for requestId '${requestId}'`);
    }

    const dispatchResult = this.dispatch(conv, {
      type: 'ResolvePermission',
      requestId,
      optionId,
    });
    if (!dispatchResult.success) return dispatchResult;

    this.permissionBroker.settle(requestId, optionId);
    return ok();
  }

  stop(conversationId: string): Result<void, AcpRuntimeError> {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry) return ok();
    const proc = this.processes.get(entry.processKey);
    if (!proc) {
      this.conversationIndex.delete(conversationId);
      return ok();
    }
    const conv = proc.conversations.get(conversationId);

    if (conv?.acpSessionId && proc.agent.closeSession) {
      proc.agent.closeSession({ sessionId: conv.acpSessionId }).catch(() => {});
      proc.sessionToConversation.delete(conv.acpSessionId);
    }

    proc.conversations.delete(conversationId);
    this.conversationIndex.delete(conversationId);

    if (conv) {
      this.clearAgentTurnQuiesce(conv);
      this.drainPermissionResolvers(conv);
      this.terminals.disposeConversation(conv.conversationId);
    }

    if (conv) {
      this.deps.listener.onClosed({
        conversationId: conv.conversationId,
        taskId: conv.taskId,
        exitCode: null,
      });
    }

    if (proc.conversations.size === 0) {
      this.teardownProcess(entry.processKey, proc);
    }
    return ok();
  }

  async setModel(conversationId: string, model: string): Promise<Result<void, AcpRuntimeError>> {
    const entry = this.conversationIndex.get(conversationId);
    const proc = entry ? this.processes.get(entry.processKey) : undefined;
    const conv = proc ? proc.conversations.get(conversationId) : undefined;

    if (proc && conv && entry?.acpSessionId && proc.agent.setSessionConfigOption) {
      const result = await this.applyConfigOptionInternal(
        proc.agent,
        entry.acpSessionId,
        'model',
        model,
        conv
      );
      if (!result.success) return result;
    }

    return ok();
  }

  async setConfigOption(
    conversationId: string,
    configId: string,
    value: string
  ): Promise<Result<void, AcpRuntimeError>> {
    const entry = this.conversationIndex.get(conversationId);
    const proc = entry ? this.processes.get(entry.processKey) : undefined;
    const conv = proc ? proc.conversations.get(conversationId) : undefined;

    if (proc && conv && entry?.acpSessionId && proc.agent.setSessionConfigOption) {
      const result = await this.applyConfigOptionInternal(
        proc.agent,
        entry.acpSessionId,
        configId,
        value,
        conv
      );
      if (!result.success) return result;
    }

    return ok();
  }

  async setMode(conversationId: string, modeId: string): Promise<Result<void, AcpRuntimeError>> {
    const entry = this.conversationIndex.get(conversationId);
    const proc = entry ? this.processes.get(entry.processKey) : undefined;
    const conv = proc ? proc.conversations.get(conversationId) : undefined;

    if (!conv) return acpErr.conversationNotFound(conversationId);
    if (!entry?.acpSessionId) return acpErr.noActiveSession(conversationId);
    if (!proc) return acpErr.noActiveSession(conversationId);

    // Validate the mode exists
    const decideResult = this.dispatch(conv, { type: 'SetMode', modeId });
    if (!decideResult.success) return decideResult;

    if (!proc.agent.setSessionMode) {
      return acpErr.setModeFailed({
        name: 'Error',
        message: 'Agent connection does not support setSessionMode',
      });
    }

    const req: SetSessionModeRequest = {
      sessionId: entry.acpSessionId,
      modeId,
    };
    try {
      await proc.agent.setSessionMode(req);
    } catch (e) {
      return acpErr.setModeFailed(toSerializedError(e));
    }
    return ok();
  }

  isRunning(conversationId: string): boolean {
    return this.conversationIndex.has(conversationId);
  }

  getChatHistory(conversationId: string): TranscriptState {
    const conv = this.resolveConv(conversationId);
    if (!conv) return { committed: [], active: null };
    return structuredClone(conv.transcript.snapshot);
  }

  getSessionState(conversationId: string): SessionState {
    const conv = this.resolveConv(conversationId);
    if (!conv) {
      return {
        lifecycle: 'closed',
        activeTurnId: null,
        pendingPermissions: [],
        lastStopReason: null,
        queuedPrompts: [],
        agentTurnActive: false,
        backgroundAgentCount: 0,
        isGenerating: false,
        canSubmit: false,
        canCancel: false,
      };
    }
    return conv.machine.sessionState();
  }

  getTerminals(conversationId: string): TerminalState[] {
    return this.terminals.listByConversation(conversationId);
  }

  getHostTerminals(): TerminalState[] {
    return this.terminals.listAll();
  }

  killAllTerminals(): void {
    this.terminals.killAll();
  }

  /**
   * Validate a command, apply the resulting events, and interpret all effects.
   * Returns an Err if the command is rejected; no state change occurs on rejection.
   * Emits one consolidated snapshot if any snapshot-triggering effects appeared.
   */
  private dispatch(conv: AcpConversation, command: Command): Result<void, AcpRuntimeError> {
    const result = this.dispatchEffects(conv, command);
    if (!result.success) return result;
    return ok();
  }

  private dispatchEffects(
    conv: AcpConversation,
    command: Command
  ): Result<Effect[], AcpRuntimeError> {
    const result = conv.machine.dispatch(command);
    if (!result.success) return result;
    this._interpretEffects(conv, result.data);
    return ok(result.data);
  }

  /**
   * Feed a DomainEvent into the machine and interpret all resulting effects.
   * Always succeeds — facts are unconditionally folded.
   * Emits one consolidated snapshot if any snapshot-triggering effects appeared.
   */
  private applyEvent(conv: AcpConversation, event: DomainEvent): void {
    const effects = conv.machine.apply(event);
    this._interpretEffects(conv, effects);
  }

  private _interpretEffects(conv: AcpConversation, effects: Effect[]): void {
    let needsSnapshot = false;
    for (const effect of effects) {
      switch (effect.type) {
        case 'state':
        case 'meta':
        case 'permissionRequest':
          needsSnapshot = true;
          break;
        case 'permissionResolved':
          needsSnapshot = true;
          if (effect.cancelled) {
            this.permissionBroker.cancel(effect.requestId);
          }
          break;
        default:
          this.interpretEffect(conv, effect);
      }
    }
    if (needsSnapshot) {
      this.emitSnapshot(conv);
    }
  }

  private interpretEffect(conv: AcpConversation, effect: Effect): void {
    try {
      switch (effect.type) {
        case 'closed':
          this.deps.listener.onClosed({
            conversationId: conv.conversationId,
            taskId: conv.taskId,
            exitCode: effect.exitCode,
          });
          break;

        case 'agentEvent':
          this.deps.listener.onAgentEvent({
            type: effect.phase,
            conversationId: conv.conversationId,
            projectId: conv.projectId,
            taskId: conv.taskId,
            providerId: conv.providerId,
          });
          break;

        case 'sendPrompt':
          void this.sendQueuedPrompt(conv, effect.prompt);
          break;

        case 'warn':
          this.deps.logger.warn(`AcpSessionRuntime: ${effect.message}`, {
            conversationId: conv.conversationId,
          });
          break;
      }
    } catch (err) {
      this.deps.logger.error('AcpSessionRuntime: effect interpreter caught listener error', {
        conversationId: conv.conversationId,
        effectType: effect.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async sendQueuedPrompt(
    conv: AcpConversation,
    prompt: QueuedPrompt
  ): Promise<Result<void, AcpRuntimeError>> {
    const entry = this.conversationIndex.get(conv.conversationId);
    const proc = entry ? this.processes.get(entry.processKey) : undefined;
    if (!proc) return acpErr.noActiveSession(conv.conversationId);
    return this.sendPromptInternal(proc, conv, prompt);
  }

  private dispatchAgentsChangedIfNeeded(
    conv: AcpConversation,
    previousRunningAgentCount: number
  ): void {
    const nextRunningAgentCount = runningBackgroundAgentCount(conv);
    if (nextRunningAgentCount === previousRunningAgentCount) return;
    conv.lastRunningAgentCount = nextRunningAgentCount;
    this.applyEvent(conv, { type: 'AgentsChanged', runningCount: nextRunningAgentCount });
  }

  private scheduleAgentTurnQuiesce(conv: AcpConversation): void {
    if (conv.agentTurnQuiesceTimer) clearTimeout(conv.agentTurnQuiesceTimer);
    conv.agentTurnQuiesceTimer = setTimeout(() => {
      conv.agentTurnQuiesceTimer = null;
      if (!conv.machine.agentTurnActive) return;
      conv.transcript.settleTurn({ kind: 'done', reason: 'quiesced' });
      this.emitTranscript(conv);
      this.applyEvent(conv, { type: 'AgentActivity', active: false });
    }, 250);
  }

  private clearAgentTurnQuiesce(conv: AcpConversation): void {
    if (!conv.agentTurnQuiesceTimer) return;
    clearTimeout(conv.agentTurnQuiesceTimer);
    conv.agentTurnQuiesceTimer = null;
  }

  private emitSnapshot(conv: AcpConversation): void {
    this.deps.listener.onSnapshot({
      conversationId: conv.conversationId,
      snapshot: conv.machine.sessionState(),
    });
  }

  private emitTranscript(conv: AcpConversation): void {
    this.deps.listener.onTranscript({
      conversationId: conv.conversationId,
      transcript: structuredClone(conv.transcript.snapshot),
      config: structuredClone(conv.transcript.config),
      usage: conv.transcript.usage ? structuredClone(conv.transcript.usage) : null,
      title: conv.transcript.title,
      agents: structuredClone([...conv.transcript.agents]),
      plan: conv.transcript.plan ? structuredClone(conv.transcript.plan) : null,
    });
  }

  private seedTranscriptMeta(
    conv: AcpConversation,
    meta: {
      modes?: SessionModeState | null;
      configOptions?: readonly SessionConfigOption[] | null;
    }
  ): void {
    if (meta.configOptions !== undefined) {
      conv.transcript.pushEvent({
        kind: 'config',
        options: meta.configOptions ?? [],
      });
    }
    if (meta.modes?.currentModeId) {
      conv.transcript.pushEvent({
        kind: 'mode_selected',
        modeId: meta.modes.currentModeId,
      });
    }
    if (meta.configOptions !== undefined || meta.modes?.currentModeId) {
      this.emitTranscript(conv);
    }
  }

  /**
   * Provisions a fully-initialized `AcpAgentProcess`. Called by `LifecycleMap.provision`
   * with deduplication, so concurrent `start()` calls on the same key wait for the
   * same promise instead of spawning duplicate processes.
   */
  private async provisionProcess(
    processKey: string,
    providerId: string,
    workspaceId: string,
    cwd: string,
    binding: { behavior: IAcpBehavior }
  ): Promise<Result<AcpAgentProcess, AcpRuntimeError>> {
    const connResult = await createAcpAgentConnection(
      { host: this.deps.host, behavior: binding.behavior, logger: this.deps.logger },
      {
        providerId,
        cwd,
        buildClient: () => this.buildClientHandler(processKey),
        onClosed: () => this.onProcessClosed(processKey),
      }
    );

    if (isErr(connResult)) return connResult;

    const conn = connResult.data;

    const capsResult = await conn.initialized;
    if (isErr(capsResult)) return capsResult;

    const proc: AcpAgentProcess = {
      handle: conn.handle,
      agent: conn.agent,
      normalize: conn.normalize,
      providerId,
      workspaceId,
      cwd,
      conversations: new Map(),
      sessionToConversation: new Map(),
      loadingConversations: new Set(),
      supportsLoadSession: capsResult.data.supportsLoadSession,
    };

    return ok(proc);
  }

  private teardownProcess(processKey: string, proc: AcpAgentProcess): void {
    try {
      proc.handle.kill('SIGTERM');
    } catch {
      // ignore
    }
    this.processes.teardown(processKey, async () => ok());
  }

  private onProcessClosed(processKey: string): void {
    const proc = this.processes.get(processKey);
    if (!proc) return;

    const exitCode = proc.handle.exitCode;

    for (const conv of proc.conversations.values()) {
      this.conversationIndex.delete(conv.conversationId);
      this.clearAgentTurnQuiesce(conv);
      this.applyEvent(conv, { type: 'ProcessClosed', exitCode });
      this.terminals.disposeConversation(conv.conversationId);
    }

    this.deps.logger.debug('AcpSessionRuntime: process closed', {
      processKey,
      exitCode,
      conversationCount: proc.conversations.size,
    });

    proc.conversations.clear();
    proc.sessionToConversation.clear();

    this.processes.teardown(processKey, async () => ok());
  }

  private buildClientHandler(processKey: string): Client {
    return {
      sessionUpdate: async (params: SessionNotification): Promise<void> => {
        const proc = this.processes.get(processKey);
        if (!proc) return;
        let conversationId = proc.sessionToConversation.get(params.sessionId);
        if (!conversationId && proc.loadingConversations.size > 0) {
          const pendingId = proc.loadingConversations.values().next().value;
          if (pendingId) {
            conversationId = pendingId;
            proc.sessionToConversation.set(params.sessionId, pendingId);
            const conv = proc.conversations.get(pendingId);
            if (conv) conv.acpSessionId = params.sessionId;
          }
        }
        if (!conversationId) {
          this.deps.logger.warn('AcpSessionRuntime: sessionUpdate for unknown sessionId', {
            sessionId: params.sessionId,
          });
          return;
        }
        const conv = proc.conversations.get(conversationId);
        if (!conv) return;

        const rawUpdate = params.update;

        // Route control-plane metadata to the machine while still allowing the
        // parser to own the read-model projection below.
        switch (rawUpdate.sessionUpdate) {
          case 'current_mode_update': {
            const currentModeId = rawUpdate.currentModeId;
            const currentModes = conv.machine.modes;
            if (currentModes) {
              this.applyEvent(conv, {
                type: 'MetaChanged',
                modes: { ...currentModes, currentModeId },
              });
            }
            break;
          }

          case 'config_option_update': {
            this.applyEvent(conv, {
              type: 'MetaChanged',
              configOptions: rawUpdate.configOptions,
            });
            break;
          }

          default:
            break;
        }

        const event = proc.normalize(rawUpdate);
        if (event.kind === 'ignored') return;

        const idleTranscriptEvent = isIdleAgentTranscriptEvent(conv, event);
        if (idleTranscriptEvent) {
          this.applyEvent(conv, { type: 'AgentActivity', active: true });
        }

        if (isTranscriptEvent(event) && !canAcceptTranscriptEvent(conv)) {
          this.deps.logger.warn(
            'AcpSessionRuntime: dropping transcript update outside active turn',
            {
              conversationId,
              sessionUpdate: rawUpdate.sessionUpdate,
              phase: conv.machine.phase.kind,
            }
          );
          return;
        }

        const previousRunningAgentCount = conv.lastRunningAgentCount;
        conv.transcript.pushEvent(event);
        this.dispatchAgentsChangedIfNeeded(conv, previousRunningAgentCount);
        if (idleTranscriptEvent) {
          this.scheduleAgentTurnQuiesce(conv);
        }
        this.emitTranscript(conv);
      },

      requestPermission: (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        const proc = this.processes.get(processKey);
        const conversationId = proc?.sessionToConversation.get(params.sessionId);
        const conv = conversationId ? proc?.conversations.get(conversationId) : undefined;

        if (!proc || !conv || !conversationId) {
          this.deps.logger.warn('AcpSessionRuntime: requestPermission for unknown session', {
            sessionId: params.sessionId,
          });
          return Promise.resolve({ outcome: { outcome: 'cancelled' } });
        }

        const requestId = crypto.randomUUID();
        const rawToolCall = params.toolCall as
          | {
              rawInput?: unknown;
              command?: string;
              cwd?: string;
              path?: string;
              paths?: string[];
            }
          | undefined;
        const paths = [
          ...(typeof rawToolCall?.path === 'string' ? [rawToolCall.path] : []),
          ...(Array.isArray(rawToolCall?.paths) ? rawToolCall.paths : []),
        ];
        const payload: AcpPermissionRequest = {
          requestId,
          toolCallId: params.toolCall?.toolCallId,
          title: params.toolCall?.title ?? 'Unknown',
          toolKind: params.toolCall?.kind ?? undefined,
          ...(rawToolCall
            ? {
                context: {
                  ...(typeof rawToolCall.cwd === 'string' ? { cwd: rawToolCall.cwd } : {}),
                  ...(paths.length > 0 ? { paths } : {}),
                  ...(typeof rawToolCall.command === 'string' ? { command: rawToolCall.command } : {}),
                  ...(rawToolCall.rawInput !== undefined
                    ? { inputSummary: JSON.stringify(rawToolCall.rawInput).slice(0, 500) }
                    : {}),
                },
              }
            : {}),
          options: params.options.map((o) => ({
            optionId: o.optionId,
            name: o.name,
            kind: o.kind,
          })),
        };

        this.deps.logger.debug('AcpSessionRuntime: requesting user permission', {
          conversationId,
          requestId,
          title: payload.title,
        });

        this.applyEvent(conv, { type: 'PermissionRequested', request: payload });

        return this.permissionBroker.request(payload);
      },

      readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        return this.fsPort.readTextFile(params);
      },

      writeTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        return this.fsPort.writeTextFile(params);
      },

      createTerminal: async (params: CreateTerminalRequest): Promise<CreateTerminalResponse> => {
        const proc = this.processes.get(processKey);
        if (!proc) throw new Error('AcpSessionRuntime: process not found for createTerminal');
        const conv = this.convForSession(proc, params.sessionId);
        return this.terminalPort.createTerminal(conv.conversationId, proc.cwd, params);
      },

      terminalOutput: async (params: TerminalOutputRequest): Promise<TerminalOutputResponse> => {
        return this.terminalPort.terminalOutput(params);
      },

      waitForTerminalExit: async (
        params: WaitForTerminalExitRequest
      ): Promise<WaitForTerminalExitResponse> => {
        return this.terminalPort.waitForTerminalExit(params);
      },

      killTerminal: async (params: KillTerminalRequest): Promise<KillTerminalResponse> => {
        return this.terminalPort.killTerminal(params);
      },

      releaseTerminal: async (params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> => {
        return this.terminalPort.releaseTerminal(params);
      },
    };
  }

  /** Resolve a conversation by ACP sessionId, throwing if not found. */
  private convForSession(proc: AcpAgentProcess, sessionId: string): AcpConversation {
    const conversationId = proc.sessionToConversation.get(sessionId);
    if (!conversationId) {
      throw new Error(`AcpSessionRuntime: no conversation for ACP sessionId ${sessionId}`);
    }
    const conv = proc.conversations.get(conversationId);
    if (!conv) {
      throw new Error(`AcpSessionRuntime: conversation ${conversationId} not found in process`);
    }
    return conv;
  }

  private resolveConv(conversationId: string): AcpConversation | null {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry) return null;
    const proc = this.processes.get(entry.processKey);
    return proc?.conversations.get(conversationId) ?? null;
  }

  private async sendPromptInternal(
    proc: AcpAgentProcess,
    conv: AcpConversation,
    prompt: QueuedPrompt
  ): Promise<Result<void, AcpRuntimeError>> {
    if (!conv.acpSessionId) return acpErr.noActiveSession(conv.conversationId);

    const messageId = `${conv.conversationId}-${conv.machine.nextTurnIndex}-user`;
    const dispatchResult = this.dispatchEffects(conv, { type: 'Prompt', prompt });
    if (!dispatchResult.success) return dispatchResult;
    const started = dispatchResult.data.some(
      (effect) => effect.type === 'agentEvent' && effect.phase === 'start'
    );
    if (!started) return ok();

    conv.transcript.pushEvent({
      kind: 'message',
      role: 'user',
      messageId,
      text: prompt.text,
      ...(prompt.attachments?.length
        ? {
            attachments: prompt.attachments.map((attachment, index) => ({
              id: `${messageId}-image-${index}`,
              name: attachment.name ?? `image-${index + 1}`,
              mimeType: attachment.mimeType,
            })),
          }
        : {}),
    });
    this.emitTranscript(conv);

    try {
      const res = await proc.agent.prompt({
        sessionId: conv.acpSessionId!,
        prompt: [
          ...(prompt.attachments ?? [])
            .filter((img) => img.type === 'image')
            .map((img) => ({
              type: 'image' as const,
              data: img.data,
              mimeType: img.mimeType,
            })),
          ...(prompt.text ? [{ type: 'text' as const, text: prompt.text }] : []),
        ],
      });
      conv.transcript.settleTurn(outcomeFromStopReason(res.stopReason));
      this.emitTranscript(conv);
      this.applyEvent(conv, {
        type: 'TurnEnded',
        outcome: { kind: 'stopped', stopReason: res.stopReason },
      });
      return ok();
    } catch (e) {
      const errResult = acpErr.promptFailed(toSerializedError(e));
      this.deps.logger.error('AcpSessionRuntime: prompt error', {
        conversationId: conv.conversationId,
        error: errResult.error.type,
      });
      conv.transcript.settleTurn({ kind: 'error', reason: 'prompt_failed' });
      this.emitTranscript(conv);
      this.applyEvent(conv, { type: 'TurnEnded', outcome: { kind: 'errored' } });
      return errResult;
    }
  }

  private async applyConfigOptionInternal(
    agent: AcpAgentApi,
    acpSessionId: string,
    configId: string,
    value: string,
    conv: AcpConversation
  ): Promise<Result<void, AcpRuntimeError>> {
    if (!agent.setSessionConfigOption) return ok();
    const req: SetSessionConfigOptionRequest = { sessionId: acpSessionId, configId, value };
    try {
      const resp = await agent.setSessionConfigOption(req);
      this.applyEvent(conv, {
        type: 'MetaChanged',
        configOptions: resp.configOptions,
      });
      this.seedTranscriptMeta(conv, { configOptions: resp.configOptions });
      return ok();
    } catch (e) {
      const errResult = acpErr.setConfigFailed(toSerializedError(e));
      this.deps.logger.warn('AcpSessionRuntime: failed to apply config option', {
        conversationId: conv.conversationId,
        configId,
        error: errResult.error.type,
      });
      return errResult;
    }
  }

  private buildNewSessionRequest(cwd: string): NewSessionRequest {
    return { cwd, mcpServers: [] };
  }

  private buildLoadSessionRequest(cwd: string, sessionId: string): LoadSessionRequest {
    return { sessionId, cwd, mcpServers: [] };
  }

  private cleanupFailedConversation(
    processKey: string,
    proc: AcpAgentProcess,
    conv: AcpConversation
  ): void {
    for (const [sid, cId] of proc.sessionToConversation) {
      if (cId === conv.conversationId) {
        proc.sessionToConversation.delete(sid);
      }
    }
    proc.conversations.delete(conv.conversationId);
    this.conversationIndex.delete(conv.conversationId);
    if (proc.conversations.size === 0) {
      this.teardownProcess(processKey, proc);
    }
  }

  private drainPermissionResolvers(conv: AcpConversation): void {
    this.permissionBroker.drain(conv.machine.pendingPermissions);
  }
}

function isTranscriptEvent(event: NormalizedEvent): boolean {
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

function isIdleAgentTranscriptEvent(conv: AcpConversation, event: NormalizedEvent): boolean {
  return (
    conv.machine.phase.kind === 'ready' &&
    isTranscriptEvent(event) &&
    !(event.kind === 'message' && event.role === 'user')
  );
}

function canAcceptTranscriptEvent(conv: AcpConversation): boolean {
  return (
    conv.machine.phase.kind === 'working' ||
    conv.machine.phase.kind === 'replaying' ||
    conv.machine.phase.kind === 'ready' ||
    conv.machine.agentTurnActive
  );
}

function runningBackgroundAgentCount(conv: AcpConversation): number {
  return conv.transcript.agents.filter(
    (agent) => agent.background === true && agent.status === 'running'
  ).length;
}

function outcomeFromStopReason(stopReason: StopReason): TranscriptTurnOutcome {
  if (stopReason === 'cancelled') {
    return { kind: 'cancelled', reason: stopReason };
  }
  return { kind: 'done', reason: stopReason };
}
