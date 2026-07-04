import type { Result } from '@emdash/shared';
import { ok } from '@emdash/shared';
import { AgentTerminalManager } from '../agent-terminal-manager';
import { FsPort, TerminalPort } from '../client-ports';
import { ConnectionPool } from '../connection/pool';
import type { AcpRuntimeError } from '../errors';
import type { PromptInput } from '../models/prompt';
import type { SessionState } from '../models/session';
import type { TerminalState } from '../models/terminals';
import type { TranscriptTurn } from '../models/turns';
import type { SessionLiveModels, SessionsListModel } from '../state/live-models';
import { SessionManager, type HistoryPage } from './session-manager';
import type { AcpRuntimeDeps, AcpStartInput } from './types';

export class AcpRuntime {
  readonly terminals: AgentTerminalManager;
  readonly pool: ConnectionPool;
  readonly manager: SessionManager;

  constructor(private readonly deps: AcpRuntimeDeps) {
    this.terminals = new AgentTerminalManager(deps.host, {
      onTerminalCreated: () => {},
      onTerminalOutput: () => {},
      onTerminalExit: () => {},
      onTerminalReleased: () => {},
    });
    const fs = new FsPort(deps.host);
    const terminalPort = new TerminalPort(this.terminals);
    let manager: SessionManager | null = null;
    this.pool = new ConnectionPool({
      host: deps.host,
      logger: deps.logger,
      onClosed: (key, exitCode) => manager?.onProcessClosed(key, exitCode),
    });
    manager = new SessionManager(deps, this.pool, this.terminals, {
      fs,
      terminals: terminalPort,
    });
    this.manager = manager;
  }

  startSession(input: AcpStartInput): Promise<Result<{ sessionId: string }, AcpRuntimeError>> {
    return this.manager.start(input);
  }

  resumeSession(input: AcpStartInput & { sessionId: string }): Promise<Result<{ sessionId: string }, AcpRuntimeError>> {
    return this.manager.start(input);
  }

  stopSession(conversationId: string): Result<void, AcpRuntimeError> {
    return this.manager.stop(conversationId);
  }

  sendPrompt(
    conversationId: string,
    prompt: PromptInput
  ): Promise<Result<{ queued: boolean }, AcpRuntimeError>> {
    return this.manager.prompt({ conversationId, prompt });
  }

  cancelTurn(conversationId: string): Promise<Result<void, AcpRuntimeError>> {
    return this.manager.cancel(conversationId);
  }

  resolvePermission(
    conversationId: string,
    requestId: string,
    optionId: string
  ): Result<void, AcpRuntimeError> {
    return this.manager.resolvePermission(conversationId, requestId, optionId);
  }

  setModeOption(conversationId: string, modeId: string): Promise<Result<void, AcpRuntimeError>> {
    return this.manager.setMode(conversationId, modeId);
  }

  setModelOption(
    conversationId: string,
    dimension: 'model' | 'effort',
    value: string
  ): Promise<Result<void, AcpRuntimeError>> {
    return this.manager.setConfigOption(conversationId, dimension, value);
  }

  getHistory(conversationId: string, before?: number, limit?: number): Result<HistoryPage, AcpRuntimeError> {
    return ok(this.manager.getHistory(conversationId, before, limit));
  }

  getChatHistory(conversationId: string): { committed: TranscriptTurn[]; active: TranscriptTurn | null } {
    return this.manager.getChatHistory(conversationId);
  }

  getSessionState(conversationId: string): SessionState {
    return this.manager.getSessionState(conversationId);
  }

  getTerminals(conversationId: string): TerminalState[] {
    return this.manager.getTerminals(conversationId);
  }

  getHostTerminals(): TerminalState[] {
    return this.manager.getHostTerminals();
  }

  killAllTerminals(): void {
    this.manager.killAllTerminals();
  }

  sessionLiveModels(conversationId: string): SessionLiveModels | null {
    return this.manager.getLiveModels(conversationId);
  }

  sessionsListLiveModel(): SessionsListModel {
    return this.manager.sessionsList;
  }
}
// TODO: Create connection, manage sessions and deps like ports etc and serve the api (incl. commands, live models, etc.)