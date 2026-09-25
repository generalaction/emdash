import { randomUUID } from 'node:crypto';
import type { Result } from '@emdash/shared';
import { ok } from '@emdash/shared';
import type { LiveLogSource } from '@emdash/wire/live';
import type {
  AcpCancelTurnError,
  AcpChangeQueuePromptOrderError,
  AcpDeleteQueuedPromptError,
  AcpEditQueuedPromptError,
  AcpExportRawLogError,
  AcpExportTranscriptError,
  AcpLoadHistoryError,
  AcpResolvePermissionError,
  AcpSendPromptError,
  AcpSetOptionError,
  AcpSessionStartMode,
  AcpTerminateError,
  LoadHistoryResult,
  PromptInput,
  PromptPlacement,
  SessionState,
  TerminalState,
} from '#runtimes/acp/api';
import { buildAgentClient } from '#runtimes/acp/node/agent-ports/agent-client';
import { FsPort } from '#runtimes/acp/node/agent-ports/fs-port';
import { AgentTerminalManager } from '#runtimes/acp/node/agent-ports/terminal-manager';
import { TerminalPort } from '#runtimes/acp/node/agent-ports/terminal-port';
import {
  createAcpConnectionSource,
  type AcpConnectionSource,
} from '#runtimes/acp/node/connection/source';
import type { SessionLiveModels, SessionsListModel } from '#runtimes/acp/node/state/live-models';
import { SessionManager, type AcpWakeFailure } from './session-manager';
import { TerminalLiveRegistry } from './terminal-live-registry';
import type { AcpRuntimeDeps, AcpStartInput } from './types';

export class AcpRuntime {
  readonly terminals: AgentTerminalManager;
  readonly connections: AcpConnectionSource;
  readonly manager: SessionManager;
  private readonly terminalLiveRegistry: TerminalLiveRegistry;

  constructor(private readonly deps: AcpRuntimeDeps) {
    let manager: SessionManager | null = null;
    this.terminalLiveRegistry = new TerminalLiveRegistry((conversationId) =>
      manager?.syncTerminals(conversationId)
    );
    this.terminals = new AgentTerminalManager(deps.host, this.terminalLiveRegistry.hooks);
    const fs = new FsPort(deps.host);
    const terminalPort = new TerminalPort(this.terminals);
    this.connections = createAcpConnectionSource({
      host: deps.host,
      agentHost: deps.agentHost,
      logger: deps.logger,
      clock: deps.clock,
      idleTtlMs: deps.lifecycle?.connectionIdleTtlMs ?? 120_000,
      buildClient: (_agent, context) => {
        if (!manager) throw new Error('AcpRuntime session manager not initialized');
        return buildAgentClient(context, manager.router, { fs, terminals: terminalPort });
      },
      onClosed: (key, generation, exitCode) => manager?.onProcessClosed(key, generation, exitCode),
    });
    manager = new SessionManager(deps, this.connections, this.terminals, {
      fs,
      terminals: terminalPort,
    });
    this.manager = manager;
  }

  attachSession(input: AcpStartInput): ReturnType<SessionManager['attach']> {
    return this.manager.attach(input);
  }

  startSession(
    input: AcpStartInput,
    mode: AcpSessionStartMode
  ): ReturnType<SessionManager['startSession']> {
    return this.manager.startSession(input, mode);
  }

  /** Runtime-internal graceful stop (persists suspended intent); not exposed on the wire. */
  stopSession(conversationId: string): Promise<Result<void, never>> {
    return this.manager.stop(conversationId);
  }

  terminateSession(conversationId: string): Promise<Result<void, AcpTerminateError>> {
    return this.manager.kill(conversationId);
  }

  reconcile(): Promise<void> {
    return this.manager.reconcile();
  }

  sendPrompt(
    conversationId: string,
    prompt: PromptInput,
    placement?: PromptPlacement,
    promptId: string = randomUUID()
  ): Promise<Result<{ queued: boolean }, AcpSendPromptError>> {
    return this.manager.sendPrompt({ conversationId, prompt, placement, promptId });
  }

  editQueuedPrompt(
    conversationId: string,
    id: string,
    prompt: PromptInput
  ): Result<void, AcpEditQueuedPromptError> {
    return this.manager.editQueuedPrompt(conversationId, id, prompt);
  }

  deleteQueuedPrompt(conversationId: string, id: string): Result<void, AcpDeleteQueuedPromptError> {
    return this.manager.removeQueuedPrompt(conversationId, id);
  }

  changeQueuePromptOrder(
    conversationId: string,
    ids: readonly string[]
  ): Result<void, AcpChangeQueuePromptOrderError> {
    return this.manager.reorderQueue(conversationId, ids);
  }

  cancelTurn(conversationId: string): Promise<Result<void, AcpCancelTurnError>> {
    return this.manager.cancel(conversationId);
  }

  resolvePermission(
    conversationId: string,
    requestId: string,
    optionId: string
  ): Result<void, AcpResolvePermissionError> {
    return this.manager.resolvePermission(conversationId, requestId, optionId);
  }

  setOption(
    conversationId: string,
    key: 'model' | 'mode' | 'effort' | 'collaborationMode',
    value: string
  ): Promise<Result<void, AcpSetOptionError | AcpWakeFailure>> {
    return key === 'mode'
      ? this.manager.setMode(conversationId, value)
      : this.manager.setConfigOption(conversationId, key, value);
  }

  async loadHistory(
    conversationId: string,
    before?: number,
    limit?: number
  ): Promise<Result<LoadHistoryResult, AcpLoadHistoryError>> {
    return ok(this.manager.getHistory(conversationId, before, limit));
  }

  exportParsedTranscript(conversationId: string): Result<string, AcpExportTranscriptError> {
    return this.manager.exportParsedTranscript(conversationId);
  }

  exportRawAcpLog(conversationId: string): Result<string, AcpExportRawLogError> {
    return this.manager.exportRawAcpLog(conversationId);
  }

  getSessionState(conversationId: string): SessionState {
    return this.manager.getSessionState(conversationId);
  }

  getTerminals(conversationId: string): TerminalState[] {
    return this.manager.getTerminals(conversationId);
  }

  killAllTerminals(): Promise<void> {
    return this.manager.killAllTerminals();
  }

  sessionLiveModels(conversationId: string): SessionLiveModels | null {
    return this.manager.getLiveModels(conversationId);
  }

  sessionsListLiveModel(): SessionsListModel {
    return this.manager.sessionsList;
  }

  sessionLiveHost() {
    return this.manager.sessionHost;
  }

  sessionsLiveHost() {
    return this.manager.sessionsHost;
  }

  terminalOutputLog(terminalId: string): LiveLogSource | null {
    return this.terminalLiveRegistry.getTerminalLog(terminalId);
  }

  async dispose(): Promise<void> {
    await this.manager.dispose();
    await this.killAllTerminals();
    await this.connections.dispose();
  }
}
