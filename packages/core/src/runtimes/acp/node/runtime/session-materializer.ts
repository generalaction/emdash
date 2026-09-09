import type { LoadSessionRequest, NewSessionRequest } from '@agentclientprotocol/sdk';
import type { Result } from '@emdash/shared';
import { toSerializedError } from '@emdash/shared';
import { acquireResourceAsResult } from '@emdash/shared/concurrency';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import type {
  AcpStartError,
  ConversationNotFoundError,
  InvalidStateError,
} from '#runtimes/acp/api';
import { acpErr } from '#runtimes/acp/api';
import {
  isAcpConnectionError,
  type AcpConnectionEntry,
  type AcpConnectionKey,
  type AcpConnectionSource,
} from '#runtimes/acp/node/connection/source';
import { SessionCell } from '#runtimes/acp/node/session/cell';
import type { SessionCellCallbacks } from '#runtimes/acp/node/session/cell-deps';
import type { ConversationHandle } from './conversation-handle';
import type { ConnectionLeaseState, SessionRecord } from './conversation-types';
import { registrationsToAcpMcpServers, summarizeAcpMcpServers } from './mcp-servers';
import { routeOwnerId } from './session-router';
import type { AcpRuntimeDeps, AcpStartInput } from './types';

export type MaterializationStartError = AcpStartError | ConversationNotFoundError;

export type MaterializedSession = {
  record: SessionRecord;
  initialQueueConsumed: true;
};

export interface SessionMaterializerCallbacks {
  isCurrent(entry: ConversationHandle, epoch: number): boolean;
  onRecordCreated(record: SessionRecord, scope: Scope): void;
  onRecordChanged(record: SessionRecord): void;
  onRecordClosed(record: SessionRecord): void;
  discardRecord(record: SessionRecord): void;
  registerRoute(processOwner: string, acpSessionId: string, conversationId: string): void;
  beginLoad(processOwner: string, acpSessionId: string, conversationId: string): () => void;
}

export class SessionMaterializer {
  private readonly handshakeTails = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: Pick<AcpRuntimeDeps, 'agentHost' | 'resolveAttachment'> & {
      logger: Logger;
    },
    private readonly connections: AcpConnectionSource,
    private readonly callbacks: SessionMaterializerCallbacks
  ) {}

  async materialize(
    entry: ConversationHandle,
    input: AcpStartInput,
    epoch: number,
    scope: Scope,
    signal: AbortSignal
  ): Promise<Result<MaterializedSession, MaterializationStartError>> {
    const binding = this.deps.agentHost.resolveAcp(input.providerId);
    if (!binding) return acpErr.providerUnsupported(input.providerId);

    const connectionKey: AcpConnectionKey = {
      providerId: input.providerId,
      cwd: input.cwd,
      env: input.env,
    };
    const acquire = await acquireResourceAsResult(
      this.connections,
      connectionKey,
      isAcpConnectionError
    );
    if (!acquire.success) return acquire;

    const acquired = acquire.data;
    const connectionLeaseState: ConnectionLeaseState = { release: true };
    scope.add(async () => {
      if (connectionLeaseState.release) await acquired.release();
    });
    if (!this.callbacks.isCurrent(entry, epoch)) {
      return acpErr.conversationNotFound(entry.conversationId);
    }

    const connection = acquired.value;
    const mcpServers = await this.resolveSessionMcpServers(input.providerId, connection);
    const mcpServerSummary = summarizeAcpMcpServers(mcpServers);
    const processOwner = routeOwnerId(connection.key, connection.generation);
    let record: SessionRecord | null = null;
    let resumeOutcome: SessionRecord['resumeOutcome'] = input.sessionId ? 'replaced-by-new' : null;

    try {
      if (input.sessionId && connection.supportsLoadSession && connection.agent.loadSession) {
        let releaseHandshake: () => void;
        try {
          releaseHandshake = await this.acquireHandshake(processOwner, signal);
        } catch {
          return acpErr.conversationNotFound(entry.conversationId);
        }
        record = this.createRecord(
          entry,
          input,
          connection,
          connectionLeaseState,
          input.sessionId,
          epoch,
          scope
        );
        let loaded = false;
        let endLoad = () => {};
        try {
          endLoad = this.callbacks.beginLoad(processOwner, input.sessionId, input.conversationId);
          record.cell.beginReplay();
          const response = await abortable(
            connection.agent.loadSession(
              this.buildLoadSessionRequest(input.cwd, input.sessionId, mcpServers)
            ),
            signal
          );
          if (!this.callbacks.isCurrent(entry, epoch) || record.disposed) {
            return acpErr.conversationNotFound(entry.conversationId);
          }
          record.cell.applySessionLoaded({
            modes: response.modes,
            configOptions: response.configOptions,
          });
          await this.applyDesiredConfiguration(record, entry, response.configOptions !== undefined);
          const queueResult = this.queueInitialPrompts(record, input);
          if (!queueResult.success) return queueResult;
          record.cell.endReplay();
          loaded = true;
          resumeOutcome = 'loaded';
        } catch (error) {
          if (!this.callbacks.isCurrent(entry, epoch)) {
            return acpErr.conversationNotFound(entry.conversationId);
          }
          if (isAuthRequiredError(error)) throw error;
          this.deps.logger.warn('SessionMaterializer: loadSession failed, starting a new session', {
            conversationId: input.conversationId,
          });
        } finally {
          endLoad();
          releaseHandshake();
        }

        if (!loaded) {
          this.callbacks.discardRecord(record);
          record = null;
        }
      }

      if (!record) {
        let response;
        try {
          response = await abortable(
            connection.agent.newSession(this.buildNewSessionRequest(input.cwd, mcpServers)),
            signal
          );
        } catch (error) {
          if (!this.callbacks.isCurrent(entry, epoch)) {
            return acpErr.conversationNotFound(entry.conversationId);
          }
          if (isAuthRequiredError(error)) throw error;
          return acpErr.newSessionFailed(toSerializedError(error));
        }
        if (!this.callbacks.isCurrent(entry, epoch)) {
          return acpErr.conversationNotFound(entry.conversationId);
        }
        record = this.createRecord(
          entry,
          input,
          connection,
          connectionLeaseState,
          response.sessionId,
          epoch,
          scope
        );
        record.cell.applySessionMeta({
          modes: response.modes,
          configOptions: response.configOptions,
        });
        await this.applyDesiredConfiguration(record, entry, response.configOptions !== undefined);
        const queueResult = this.queueInitialPrompts(record, input);
        if (!queueResult.success) return queueResult;
        record.cell.applySessionReady();
      }

      this.callbacks.registerRoute(
        routeOwnerId(connection.key, connection.generation),
        record.cell.acpSessionId,
        input.conversationId
      );
      record.mcpServers = mcpServerSummary;
      record.resumeOutcome = resumeOutcome;
      return { success: true, data: { record, initialQueueConsumed: true } };
    } catch (error) {
      if (isAuthRequiredError(error)) return acpErr.authRequired(toSerializedError(error));
      return acpErr.initializeFailed(toSerializedError(error));
    }
  }

  private async acquireHandshake(processOwner: string, signal: AbortSignal): Promise<() => void> {
    const predecessor = this.handshakeTails.get(processOwner) ?? Promise.resolve();
    let releaseCurrent = () => {};
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve;
    });
    const tail = predecessor.catch(() => {}).then(() => current);
    this.handshakeTails.set(processOwner, tail);
    try {
      await abortable(
        predecessor.catch(() => {}),
        signal
      );
    } catch (error) {
      releaseCurrent();
      this.cleanupHandshake(processOwner, tail);
      throw error;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseCurrent();
      this.cleanupHandshake(processOwner, tail);
    };
  }

  private cleanupHandshake(processOwner: string, tail: Promise<void>): void {
    void tail.then(() => {
      if (this.handshakeTails.get(processOwner) === tail) {
        this.handshakeTails.delete(processOwner);
      }
    });
  }

  private createRecord(
    conversation: ConversationHandle,
    input: AcpStartInput,
    connection: AcpConnectionEntry,
    connectionLeaseState: ConnectionLeaseState,
    acpSessionId: string,
    epoch: number,
    scope: Scope
  ): SessionRecord {
    const recordRef: { current?: SessionRecord } = {};
    const callbacks: SessionCellCallbacks = {
      onSessionStateChanged: () => {
        if (recordRef.current) this.callbacks.onRecordChanged(recordRef.current);
      },
      onTranscriptChanged: () => {
        if (recordRef.current) this.callbacks.onRecordChanged(recordRef.current);
      },
      onClosed: () => {
        if (recordRef.current) this.callbacks.onRecordClosed(recordRef.current);
      },
      onSendQueuedPrompt: () => {
        if (recordRef.current) this.callbacks.onRecordChanged(recordRef.current);
      },
    };
    const cell = new SessionCell({
      conversationId: input.conversationId,
      providerId: input.providerId,
      acpSessionId,
      agent: connection.agent,
      resolveAttachment: this.deps.resolveAttachment,
      logger: this.deps.logger,
      callbacks,
    });
    const record: SessionRecord = {
      conversation,
      epoch,
      input,
      resumeOutcome: null,
      clearedConfiguration: [],
      processKey: connection.key,
      processGeneration: connection.generation,
      connectionLeaseState,
      cell,
      mcpServers: [],
      machineStateBinding: {
        dispose: cell.machine.subscribe(() => {
          if (recordRef.current) this.callbacks.onRecordChanged(recordRef.current);
        }),
      },
      disposed: false,
    };
    recordRef.current = record;
    this.callbacks.onRecordCreated(record, scope);
    return record;
  }

  private queueInitialPrompts(
    record: SessionRecord,
    input: AcpStartInput
  ): Result<void, InvalidStateError> {
    for (const prompt of input.initialQueue ?? []) {
      const result = record.cell.queuePrompt(prompt);
      if (!result.success) return result;
    }
    return { success: true, data: undefined };
  }

  private async applyConfigOverrides(
    record: SessionRecord,
    entry: ConversationHandle,
    hasAuthoritativeCatalog: boolean
  ): Promise<Array<'model' | 'effort' | 'collaborationMode'>> {
    const cleared: Array<'model' | 'effort' | 'collaborationMode'> = [];
    for (const dimension of ['model', 'effort', 'collaborationMode'] as const) {
      const value = entry.configOverrides[dimension];
      if (!value) continue;
      const catalog =
        dimension === 'model'
          ? record.cell.config.modelOptions
          : dimension === 'effort'
            ? record.cell.config.efforts
            : record.cell.config.collaborationModeOptions;
      if (
        (!catalog && hasAuthoritativeCatalog) ||
        (catalog && !catalog.available.some((option) => option.id === value))
      ) {
        entry.clearConfig(dimension);
        cleared.push(dimension);
        continue;
      }
      const result = await record.cell.setConfigOption(dimension, value);
      if (!result.success) {
        this.deps.logger.warn('SessionMaterializer: failed to apply retained config option', {
          conversationId: entry.conversationId,
          providerId: entry.descriptor.providerId,
          dimension,
          error: result.error,
        });
      }
    }
    return cleared;
  }

  private async applyDesiredConfiguration(
    record: SessionRecord,
    entry: ConversationHandle,
    hasAuthoritativeCatalog: boolean
  ): Promise<void> {
    let revision: number;
    do {
      revision = entry.desiredRevision;
      const cleared = await this.applyConfigOverrides(record, entry, hasAuthoritativeCatalog);
      const clearedMode = await this.applyInitialMode(record, entry);
      for (const key of [...cleared, ...(clearedMode ? [clearedMode] : [])]) {
        if (!record.clearedConfiguration.includes(key)) record.clearedConfiguration.push(key);
      }
    } while (entry.desiredRevision !== revision);
  }

  private async resolveSessionMcpServers(providerId: string, connection: AcpConnectionEntry) {
    try {
      const result = await this.deps.agentHost.readMcpServers(providerId);
      if (!result.success) {
        this.deps.logger.warn('SessionMaterializer: failed to read MCP servers for session', {
          providerId,
          error: 'message' in result.error ? result.error.message : result.error.type,
        });
        return [];
      }
      return registrationsToAcpMcpServers(result.data, connection.mcpCapabilities);
    } catch (error) {
      this.deps.logger.warn('SessionMaterializer: failed to read MCP servers for session', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async applyInitialMode(
    record: SessionRecord,
    entry: ConversationHandle
  ): Promise<'modeId' | null> {
    const modeId = entry.descriptor.modeId;
    if (!modeId) return null;
    const modeOptions = record.cell.config.modeOptions;
    if (!modeOptions) return null;
    if (!modeOptions.available.some((mode) => mode.id === modeId)) {
      this.deps.logger.debug('SessionMaterializer: persisted mode not advertised, skipping', {
        conversationId: entry.conversationId,
        providerId: entry.descriptor.providerId,
        modeId,
      });
      entry.clearMode();
      return 'modeId';
    }
    if (modeOptions.selected === modeId) return null;
    const result = await record.cell.setMode(modeId);
    if (!result.success) {
      this.deps.logger.warn('SessionMaterializer: failed to apply initial mode', {
        conversationId: entry.conversationId,
        providerId: entry.descriptor.providerId,
        modeId,
        error: result.error,
      });
    }
    return null;
  }

  private buildNewSessionRequest(
    cwd: string,
    mcpServers: NewSessionRequest['mcpServers']
  ): NewSessionRequest {
    return { cwd, mcpServers };
  }

  private buildLoadSessionRequest(
    cwd: string,
    sessionId: string,
    mcpServers: LoadSessionRequest['mcpServers']
  ): LoadSessionRequest {
    return { cwd, sessionId, mcpServers };
  }
}

function isAuthRequiredError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { code?: unknown; cause?: unknown };
  if (value.code === -32000) return true;
  return isAuthRequiredError(value.cause);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
