import type {
  AttachmentMimeType,
  AttachmentRef,
  AcpRuntimeError,
  HistoryPage,
  PlanState,
  PromptInput,
  PromptPlacement,
  SessionConfigState,
  SessionMcpServer,
  SessionState,
  SessionUsage,
  TerminalState,
  TranscriptTurn,
} from '@emdash/core/runtimes/acp/api/client';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { createEmitter, type Result, type Unsubscribe } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { TimeoutError, runWithTimeout } from '@emdash/shared/scheduling';
import { ReplicaLog, createLineLogStore } from '@emdash/wire/live';
import { type BlobSource } from '@emdash/wire/rpc';
import { observe, remote, whenReady, type Readable } from '@emdash/wire/state';
import { observable, runInAction } from 'mobx';
import {
  getConversationsClient,
  type ConversationsClient,
} from '@core/features/conversations/api/browser/client';
import type { ProjectAttachmentError } from '@core/features/projects/api/attachments';
import { conversationsContract } from '../../api';

export interface LiveValueSource<T> {
  getSnapshot(): T;
  subscribe(cb: () => void): Unsubscribe;
}

/**
 * Line-structured live terminal output. `lines()` returns the store's
 * identity-stable array (mutated in place); `version()` bumps once per
 * frame-coalesced flush; `truncated()` is true when output was dropped
 * upstream (agent ring buffer) or by the client store's byte cap.
 */
export type AcpTerminalOutput = {
  lines(): readonly string[];
  truncated(): boolean;
  version(): number;
  onFlush(listener: () => void): Unsubscribe;
};

type RemoteValueState<T> = {
  readonly ready: Promise<void>;
  current(): T;
  onChange(cb: (value: T) => void): Unsubscribe;
  dispose(): Promise<void>;
};

export function asValueSource<T>(replica: RemoteValueState<T>): LiveValueSource<T> {
  return {
    getSnapshot: () => replica.current(),
    subscribe: (cb) => replica.onChange(() => cb()),
  };
}

export class AcpStartError extends Error {
  constructor(
    readonly runtimeError: AcpRuntimeError | RuntimeResolveError | ProjectAttachmentError
  ) {
    super(
      ('message' in runtimeError ? runtimeError.message : undefined) ??
        ('cause' in runtimeError ? runtimeError.cause?.message : undefined) ??
        runtimeError.type
    );
    this.name = 'AcpStartError';
  }

  get errorType(): (AcpRuntimeError | RuntimeResolveError | ProjectAttachmentError)['type'] {
    return this.runtimeError.type;
  }
}

export class AcpLiveSession {
  readonly activationId: RemoteValueState<string | null>;
  readonly sessionState: RemoteValueState<SessionState>;
  readonly config: RemoteValueState<SessionConfigState>;
  readonly usage: RemoteValueState<SessionUsage | null>;
  readonly plan: RemoteValueState<PlanState | null>;
  readonly activeTurn: RemoteValueState<TranscriptTurn | null>;
  readonly terminals: RemoteValueState<TerminalState[]>;
  readonly mcpServers: RemoteValueState<SessionMcpServer[]>;
  private readonly scope = createScope({ label: 'acp-live-session' });
  private readonly terminalLogs = new Map<
    string,
    { replica: ReplicaLog; output: AcpTerminalOutput }
  >();
  private disposed = false;

  private constructor(
    readonly conversationId: string,
    private readonly client: ConversationsClient['acp'],
    private readonly activationFence: string
  ) {
    const key = { conversationId };
    const sessionRemote = remote(conversationsContract.acp.session, client.session, {
      scope: this.scope,
      lingerMs: 15_000,
    });
    const member = sessionRemote(key);
    this.activationId = remoteValueState(member.states.activationId, this.scope);
    this.sessionState = remoteValueState(member.states.state, this.scope);
    this.config = remoteValueState(member.states.config, this.scope);
    this.usage = remoteValueState(member.states.usage, this.scope);
    this.plan = remoteValueState(member.states.plan, this.scope);
    this.activeTurn = remoteValueState(member.states.activeTurn, this.scope);
    this.terminals = remoteValueState(member.states.terminals, this.scope);
    this.mcpServers = remoteValueState(member.states.mcpServers, this.scope);
  }

  static async create(conversationId: string): Promise<AcpLiveSession> {
    const client = (await getConversationsClient()).acp;
    const result = await withTimeout(
      (signal) => client.start({ conversationId }, { signal }),
      'Timed out starting ACP session'
    );
    if (!result.success) {
      throw new AcpStartError(result.error);
    }
    const session = new AcpLiveSession(conversationId, client, result.data.activationId);
    try {
      await withTimeout(
        Promise.all([
          session.activationId.ready,
          session.sessionState.ready,
          session.config.ready,
          session.usage.ready,
          session.plan.ready,
          session.activeTurn.ready,
          session.terminals.ready,
          session.mcpServers.ready,
        ]),
        'Timed out connecting ACP live models'
      );
      if (
        session.activationId.current() !== result.data.activationId ||
        session.sessionState.current().lifecycle === 'closed'
      ) {
        throw new Error('ACP activation changed while connecting live models');
      }
      return session;
    } catch (error) {
      session.dispose();
      throw error;
    }
  }

  start(): Promise<Result<{ sessionId: string; activationId: string }, unknown>> {
    return this.client.start({ conversationId: this.conversationId });
  }

  async resume(): Promise<Result<HistoryPage, unknown>> {
    const result = await this.client.resume({ conversationId: this.conversationId });
    if (!result.success) return result;
    return {
      success: true,
      data: {
        turns: result.data.turns,
        nextCursor: result.data.nextCursor,
      },
    };
  }

  getHistory(before?: number, limit = 50): Promise<Result<HistoryPage, unknown>> {
    return this.client.getHistory({
      conversationId: this.conversationId,
      before,
      limit,
      activationId: this.activationFence,
    });
  }

  async exportTranscript(): Promise<Result<string, unknown>> {
    const result = await this.client.exportAcpTranscript({
      conversationId: this.conversationId,
      activationId: this.activationFence,
    });
    if (!result.success) return result;
    return { success: true, data: result.data.transcript };
  }

  async exportRawAcpLog(): Promise<Result<string, unknown>> {
    const result = await this.client.exportRawAcpLog({
      conversationId: this.conversationId,
      activationId: this.activationFence,
    });
    if (!result.success) return result;
    return { success: true, data: result.data.log };
  }

  uploadAttachment(input: {
    data?: Uint8Array;
    source?: BlobSource;
    size?: number;
    mimeType: AttachmentMimeType;
    name?: string;
    originalPath?: string;
  }): Promise<Result<AttachmentRef, unknown>> {
    return this.client.uploadAttachment(
      { conversationId: this.conversationId, originalPath: input.originalPath },
      {
        name: input.name ?? 'attachment',
        mimeType: input.mimeType,
        size: input.size ?? input.data?.byteLength,
        source:
          input.source ?? (input.data ? singleChunk(input.data) : singleChunk(new Uint8Array())),
      }
    );
  }

  downloadAttachment(
    id: string
  ): Promise<Result<{ ref: AttachmentRef; data: Uint8Array }, unknown>> {
    return this.client
      .downloadAttachment({ conversationId: this.conversationId, attachmentId: id })
      .then(async (result) => {
        if (!result.success) return result;
        return {
          success: true,
          data: {
            ref: result.data.meta,
            data: await result.data.bytes(),
          },
        };
      });
  }

  deleteAttachment(id: string): Promise<Result<void, unknown>> {
    return this.client.deleteAttachment({
      conversationId: this.conversationId,
      attachmentId: id,
    });
  }

  sendPrompt(
    prompt: PromptInput,
    placement?: PromptPlacement
  ): Promise<Result<{ queued: boolean }, unknown>> {
    return this.client.sendPrompt(
      {
        conversationId: this.conversationId,
        prompt,
        placement,
        activationId: this.activationFence,
      },
      { timeoutMs: 0 }
    );
  }

  editQueuedPrompt(id: string, input: PromptInput): Promise<Result<void, unknown>> {
    return this.client.editQueuedPrompt({
      conversationId: this.conversationId,
      id,
      input,
      activationId: this.activationFence,
    });
  }

  deleteQueuedPrompt(id: string): Promise<Result<void, unknown>> {
    return this.client.deleteQueuedPrompt({
      conversationId: this.conversationId,
      id,
      activationId: this.activationFence,
    });
  }

  changeQueuePromptOrder(ids: string[]): Promise<Result<void, unknown>> {
    return this.client.changeQueuePromptOrder({
      conversationId: this.conversationId,
      ids,
      activationId: this.activationFence,
    });
  }

  cancelTurn(): Promise<Result<void, unknown>> {
    return this.client.cancelTurn({ conversationId: this.conversationId });
  }

  setModelOption(dimension: 'model' | 'effort', value: string): Promise<Result<void, unknown>> {
    return this.client.setModelOption({
      conversationId: this.conversationId,
      dimension,
      value,
      activationId: this.activationFence,
    });
  }

  setModeOption(value: string): Promise<Result<void, unknown>> {
    return this.client.setModeOption({
      conversationId: this.conversationId,
      value,
      activationId: this.activationFence,
    });
  }

  resolvePermission(requestId: string, optionId: string): Promise<Result<void, unknown>> {
    return this.client.resolvePermission({
      conversationId: this.conversationId,
      requestId,
      optionId,
      activationId: this.activationFence,
    });
  }

  async terminalOutput(terminalId: string): Promise<AcpTerminalOutput> {
    if (this.disposed || this.activationId.current() !== this.activationFence) {
      throw new Error('ACP activation changed before terminal output could be attached');
    }
    const existing = this.terminalLogs.get(terminalId);
    if (existing) return existing.output;
    const store = createLineLogStore();
    const replica = new ReplicaLog(
      this.client.terminalOutput.handle({ conversationId: this.conversationId, terminalId }),
      { store }
    );
    const output: AcpTerminalOutput = {
      lines: () => store.lines(),
      truncated: () => store.truncated(),
      version: () => store.version(),
      onFlush: (listener) => store.onFlush(listener),
    };
    this.terminalLogs.set(terminalId, { replica, output });
    await replica.ready;
    if (this.disposed || this.activationId.current() !== this.activationFence) {
      this.terminalLogs.delete(terminalId);
      await replica.dispose();
      throw new Error('ACP activation changed while terminal output was attaching');
    }
    return output;
  }

  dispose(): void {
    this.disposed = true;
    void this.scope.dispose();
    for (const { replica } of this.terminalLogs.values()) {
      void replica.dispose();
    }
    this.terminalLogs.clear();
  }
}

async function* singleChunk(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}

export function remoteValueState<T>(
  source: Readable<T | undefined>,
  parentScope: Scope
): RemoteValueState<T> {
  const scope = parentScope.child('remote-value-state');
  const changes = createEmitter<T>();
  const value = observable.box<T | undefined>(undefined, { deep: false });
  const update = (next: T): void => {
    runInAction(() => value.set(next));
  };
  const ready = whenReady(source, { scope }).then((settled) => {
    if (settled.status === 'error' && settled.value === undefined) {
      throw readableError(settled.error);
    }
    if (settled.value !== undefined) update(settled.value);
  });
  observe(
    source,
    (snapshot) => {
      if (snapshot.value !== undefined) {
        const next = snapshot.value;
        update(next);
        changes.emit(next);
      }
    },
    { scope }
  );
  return {
    ready,
    current() {
      return value.get() as T;
    },
    onChange(cb) {
      return changes.subscribe(cb);
    },
    dispose() {
      return scope.dispose();
    },
  };
}

function readableError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(error === undefined ? 'Remote live model failed to load' : String(error));
}

function withTimeout<T>(
  work: Promise<T> | ((signal: AbortSignal) => Promise<T>),
  message: string,
  ms = 10_000
): Promise<T> {
  return runWithTimeout((signal) => (typeof work === 'function' ? work(signal) : work), {
    timeoutMs: ms,
  }).catch((error: unknown) => {
    if (error instanceof TimeoutError) throw new Error(message);
    throw error;
  });
}
