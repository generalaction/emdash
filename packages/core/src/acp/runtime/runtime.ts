import type { Result } from '@emdash/shared';
import { ok } from '@emdash/shared';
import type { LiveLog } from '@emdash/wire';
import { AgentTerminalManager } from '../agent-terminal-manager';
import type { ResumeResult } from '../api/queries';
import { FsPort, TerminalPort } from '../client-ports';
import { ConnectionPool } from '../connection/pool';
import type { AcpRuntimeError } from '../errors';
import { acpErr } from '../errors';
import type { AttachmentMimeType, AttachmentRef } from '../models/attachments';
import type { PromptDraftUpdate, PromptInput } from '../models/prompt';
import type { SessionState } from '../models/session';
import type { TerminalState } from '../models/terminals';
import type { TranscriptTurn } from '../models/turns';
import type { SessionLiveModels, SessionsListModel } from '../state/live-models';
import type { StoredAttachment } from './attachment-store';
import { SessionManager, type HistoryPage } from './session-manager';
import { TerminalLiveRegistry } from './terminal-live-registry';
import type { AcpRuntimeDeps, AcpStartInput } from './types';

export class AcpRuntime {
  readonly terminals: AgentTerminalManager;
  readonly pool: ConnectionPool;
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

  async resumeSession(
    input: AcpStartInput & { sessionId: string },
    limit = 50
  ): Promise<Result<ResumeResult, AcpRuntimeError>> {
    const result = await this.manager.start(input);
    if (!result.success) return result;
    const page = this.manager.getHistory(input.conversationId, undefined, limit);
    return ok({ sessionId: result.data.sessionId, ...page });
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

  queuePrompt(
    conversationId: string,
    prompt: PromptInput
  ): Result<{ queued: boolean }, AcpRuntimeError> {
    return this.manager.queuePrompt({ conversationId, prompt });
  }

  editQueuedPrompt(
    conversationId: string,
    id: string,
    prompt: PromptInput
  ): Result<void, AcpRuntimeError> {
    return this.manager.editQueuedPrompt(conversationId, id, prompt);
  }

  deleteQueuedPrompt(conversationId: string, id: string): Result<void, AcpRuntimeError> {
    return this.manager.removeQueuedPrompt(conversationId, id);
  }

  changeQueuePromptOrder(
    conversationId: string,
    ids: readonly string[]
  ): Result<void, AcpRuntimeError> {
    return this.manager.reorderQueue(conversationId, ids);
  }

  cancelTurn(conversationId: string): Promise<Result<void, AcpRuntimeError>> {
    return this.manager.cancel(conversationId);
  }

  setPromptDraft(conversationId: string, draft: PromptDraftUpdate): Result<void, AcpRuntimeError> {
    return this.manager.setPromptDraft(conversationId, draft);
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

  getHistory(
    conversationId: string,
    before?: number,
    limit?: number
  ): Result<HistoryPage, AcpRuntimeError> {
    return ok(this.manager.getHistory(conversationId, before, limit));
  }

  getChatHistory(conversationId: string): {
    committed: TranscriptTurn[];
    active: TranscriptTurn | null;
  } {
    return this.manager.getChatHistory(conversationId);
  }

  exportParsedTranscript(conversationId: string): Result<string, AcpRuntimeError> {
    return this.manager.exportParsedTranscript(conversationId);
  }

  exportRawAcpLog(conversationId: string): Result<string, AcpRuntimeError> {
    return this.manager.exportRawAcpLog(conversationId);
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

  async uploadAttachment(input: {
    data?: Uint8Array;
    mimeType: AttachmentMimeType;
    name?: string;
    originalPath?: string;
  }): Promise<Result<AttachmentRef, AcpRuntimeError>> {
    if (!this.deps.attachmentStore) return acpErr.invalidState('No attachment store configured');
    return ok(await this.deps.attachmentStore.put(input));
  }

  async downloadAttachment(id: string): Promise<Result<StoredAttachment, AcpRuntimeError>> {
    if (!this.deps.attachmentStore) return acpErr.invalidState('No attachment store configured');
    const stored = await this.deps.attachmentStore.get(id);
    if (!stored) return acpErr.invalidState(`Attachment '${id}' not found`);
    return ok(stored);
  }

  async deleteAttachment(id: string): Promise<Result<void, AcpRuntimeError>> {
    if (!this.deps.attachmentStore) return acpErr.invalidState('No attachment store configured');
    await this.deps.attachmentStore.delete(id);
    return ok();
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

  terminalOutputLog(terminalId: string): LiveLog | null {
    return this.terminalLiveRegistry.getTerminalLog(terminalId);
  }
}
