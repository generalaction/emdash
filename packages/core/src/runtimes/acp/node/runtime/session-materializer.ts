import type { LoadSessionRequest, NewSessionRequest } from '@agentclientprotocol/sdk';
import type { Result } from '@emdash/shared';
import { toSerializedError } from '@emdash/shared';
import { acquireResourceAsResult } from '@emdash/shared/concurrency';
import type { Scope } from '@emdash/shared/concurrency';
import { redactSecrets, type Logger } from '@emdash/shared/logger';
import type { AcpStartError, ConversationNotFoundError } from '#runtimes/acp/api';
import { acpErr } from '#runtimes/acp/api';
import { acceptsProviderValue } from '#runtimes/acp/api/models/config';
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
  unstarted: boolean;
};

export interface SessionMaterializerCallbacks {
  isCurrent(entry: ConversationHandle, epoch: number): boolean;
  onRecordCreated(record: SessionRecord, scope: Scope): void;
  onRecordChanged(record: SessionRecord): void;
  onRecordClosed(record: SessionRecord): void;
  discardRecord(record: SessionRecord): Promise<void>;
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
    let resumeOutcome: SessionRecord['resumeOutcome'] =
      entry.isStartingFresh && entry.descriptor.sessionId !== null ? 'replaced-by-new' : null;
    let unstarted = true;

    try {
      if (input.sessionId && (!connection.supportsLoadSession || !connection.agent.loadSession)) {
        return acpErr.invalidState(
          'This provider cannot restore the existing conversation. Its saved session has been preserved.'
        );
      }
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
        const wasUntouched = entry.canStartFresh;
        let loaded = false;
        let replaceUntouched = false;
        let endLoad = () => {};
        try {
          if (wasUntouched) {
            const preserved = await entry.preserveSession(record);
            if (!preserved.success) return preserved;
          }
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
            configOptions: response.configOptions,
          });
          await this.applyDesiredConfiguration(record, entry);
          const history = record.cell.history();
          unstarted = wasUntouched && history.committed.length === 0 && !history.active;
          loaded = true;
          resumeOutcome = 'loaded';
        } catch (error) {
          if (!this.callbacks.isCurrent(entry, epoch)) {
            return acpErr.conversationNotFound(entry.conversationId);
          }
          const history = record.cell.history();
          if (isAuthRequiredError(error)) throw error;
          this.deps.logger.warn('SessionMaterializer: failed to restore existing session', {
            conversationId: input.conversationId,
            sessionId: input.sessionId,
            operation: 'loadSession',
            error: toSerializedError(error),
            ...providerErrorDetails(error),
          });
          if (isSessionNotFound(error, input.sessionId, binding.behavior.isSessionNotFound)) {
            if (!wasUntouched || history.committed.length > 0 || history.active) {
              return acpErr.sessionNotFound();
            }
            replaceUntouched = true;
          } else {
            return acpErr.invalidState(
              'Could not restore this conversation. Its saved session has been preserved. Retry loading it.'
            );
          }
        } finally {
          endLoad();
          releaseHandshake();
          if (!loaded) await this.callbacks.discardRecord(record);
        }
        if (replaceUntouched) {
          record = null;
          resumeOutcome = 'replaced-by-new';
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
          configOptions: response.configOptions,
        });
        await this.applyDesiredConfiguration(record, entry);
      }

      if (!this.callbacks.isCurrent(entry, epoch) || record.disposed) {
        return acpErr.conversationNotFound(entry.conversationId);
      }
      this.callbacks.registerRoute(
        routeOwnerId(connection.key, connection.generation),
        record.cell.acpSessionId,
        input.conversationId
      );
      record.mcpServers = mcpServerSummary;
      record.resumeOutcome = resumeOutcome;
      return { success: true, data: { record, unstarted } };
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

  async applyDesiredConfiguration(record: SessionRecord, entry: ConversationHandle): Promise<void> {
    let revision: number;
    do {
      revision = entry.desiredRevision;
      const configured = entry.descriptor.options ?? {};
      const ids = Object.keys(configured).sort((a, b) => {
        const options = record.cell.config.options ?? [];
        return (
          Number(options.find((o) => o.id === b)?.category === 'model') -
          Number(options.find((o) => o.id === a)?.category === 'model')
        );
      });
      const cleared: Record<string, string | boolean> = {};
      for (const id of ids) {
        const value = configured[id]!;
        const option = record.cell.config.options?.find((o) => o.id === id);
        if (!option || !acceptsProviderValue(option, value)) {
          if (record.cell.configCatalog.kind === 'ready') cleared[id] = value;
          continue;
        }
        if (option.currentValue === value) continue;
        const applied = await record.cell.setOption(id, value);
        if (!applied.success)
          throw new Error(`Could not apply ${id}: ${JSON.stringify(applied.error)}`);
      }
      record.clearedOptions = cleared;
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

function providerErrorDetails(error: unknown): { code?: number; providerMessage?: string } {
  if (!error || typeof error !== 'object') return {};
  const code = 'code' in error && typeof error.code === 'number' ? error.code : undefined;
  const data = 'data' in error ? error.data : undefined;
  const message =
    typeof data === 'string'
      ? data
      : data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : data && typeof data === 'object' && 'details' in data && typeof data.details === 'string'
          ? data.details
          : undefined;
  return {
    ...(code !== undefined && { code }),
    ...(message !== undefined && { providerMessage: redactSecrets(message).slice(0, 2_000) }),
  };
}

function isSessionNotFound(
  error: unknown,
  sessionId: string,
  providerCheck?: (error: unknown, sessionId: string) => boolean
): boolean {
  const seen = new Set<object>();
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error);
    if (providerCheck?.(error, sessionId)) return true;
    const data = 'data' in error ? error.data : undefined;
    if (
      'code' in error &&
      error.code === -32002 &&
      data &&
      typeof data === 'object' &&
      'uri' in data &&
      data.uri === sessionId
    )
      return true;
    error = 'cause' in error ? error.cause : undefined;
  }
  return false;
}
