import {
  planStateSchema,
  promptDraftSchema,
  sessionUsageSchema,
  sessionConfigStateSchema,
  sessionMcpServerSchema,
  sessionStateSchema,
  terminalStateSchema,
  transcriptTurnSchema,
  type AttachmentMimeType,
  type AttachmentRef,
  type AcpRuntimeError,
  type HistoryPage,
  type PromptDraftUpdate,
  type PromptInput,
  type SessionState,
  type TerminalState,
} from '@emdash/core/runtimes/acp/api/client';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import type { Result, Unsubscribe } from '@emdash/shared';
import { TimeoutError, runWithTimeout } from '@emdash/shared/scheduling';
import { ReplicaLog, ReplicaState, type BlobSource, type LiveClientHandle } from '@emdash/wire';
import { createImmutableMobxStore, createMobxLogStore } from '@emdash/wire/util/mobx';
import { z } from 'zod';
import { getConversationsClient, type ConversationsClient } from '../client';

export interface LiveValueSource<T> {
  getSnapshot(): T;
  subscribe(cb: () => void): Unsubscribe;
}

export function asValueSource<T>(replica: ReplicaState<T>): LiveValueSource<T> {
  return {
    getSnapshot: () => replica.current(),
    subscribe: (cb) => replica.onChange(() => cb()),
  };
}

export class AcpStartError extends Error {
  constructor(readonly runtimeError: AcpRuntimeError | RuntimeResolveError) {
    super(
      runtimeError.message ??
        ('cause' in runtimeError ? runtimeError.cause?.message : undefined) ??
        runtimeError.type
    );
    this.name = 'AcpStartError';
  }

  get errorType(): (AcpRuntimeError | RuntimeResolveError)['type'] {
    return this.runtimeError.type;
  }
}

export class AcpLiveSession {
  readonly sessionState: ReplicaState<SessionState>;
  readonly config: ReplicaState<z.infer<typeof sessionConfigStateSchema>>;
  readonly usage: ReplicaState<z.infer<typeof sessionUsageSchema> | null>;
  readonly plan: ReplicaState<z.infer<typeof planStateSchema> | null>;
  readonly activeTurn: ReplicaState<z.infer<typeof transcriptTurnSchema> | null>;
  readonly draft: ReplicaState<z.infer<typeof promptDraftSchema> | null>;
  readonly terminals: ReplicaState<TerminalState[]>;
  readonly mcpServers: ReplicaState<Array<z.infer<typeof sessionMcpServerSchema>>>;
  private readonly terminalLogs = new Map<string, ReplicaLog>();
  private disposed = false;

  private constructor(
    readonly conversationId: string,
    private readonly client: ConversationsClient['acp']
  ) {
    const key = { conversationId };
    this.sessionState = createReplicaState(client.session.state(key, 'state'), sessionStateSchema);
    this.config = createReplicaState(client.session.state(key, 'config'), sessionConfigStateSchema);
    this.usage = createReplicaState(
      client.session.state(key, 'usage'),
      sessionUsageSchema.nullable()
    );
    this.plan = createReplicaState(client.session.state(key, 'plan'), planStateSchema.nullable());
    this.activeTurn = createReplicaState(
      client.session.state(key, 'activeTurn'),
      transcriptTurnSchema.nullable()
    );
    this.draft = createReplicaState(
      client.session.state(key, 'draft'),
      promptDraftSchema.nullable()
    );
    this.terminals = createReplicaState(
      client.session.state(key, 'terminals'),
      z.array(terminalStateSchema)
    );
    this.mcpServers = createReplicaState(
      client.session.state(key, 'mcpServers'),
      z.array(sessionMcpServerSchema)
    );
  }

  static async create(conversationId: string): Promise<AcpLiveSession> {
    const client = (await getConversationsClient()).acp;
    const result = await withTimeout(
      (signal) => client.startSession({ conversationId }, { signal }),
      'Timed out starting ACP session'
    );
    if (!result.success) {
      throw new AcpStartError(result.error);
    }
    const session = new AcpLiveSession(conversationId, client);
    await withTimeout(
      Promise.all([
        session.sessionState.ready,
        session.config.ready,
        session.usage.ready,
        session.plan.ready,
        session.activeTurn.ready,
        session.draft.ready,
        session.terminals.ready,
        session.mcpServers.ready,
      ]),
      'Timed out connecting ACP live models'
    );
    return session;
  }

  start(): Promise<Result<{ sessionId: string }, unknown>> {
    return this.client.startSession({ conversationId: this.conversationId });
  }

  async resume(): Promise<Result<HistoryPage, unknown>> {
    const result = await this.client.resumeSession({ conversationId: this.conversationId });
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
    return this.client.getHistory({ conversationId: this.conversationId, before, limit });
  }

  exportTranscript(): Promise<Result<string, unknown>> {
    return this.client.exportACPTranscript({ conversationId: this.conversationId });
  }

  exportRawAcpLog(): Promise<Result<string, unknown>> {
    return this.client.exportRawAcpLog({ conversationId: this.conversationId });
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
      .downloadAttachment({ conversationId: this.conversationId, id })
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
    return this.client.deleteAttachment({ conversationId: this.conversationId, id });
  }

  sendPrompt(prompt: PromptInput): Promise<Result<{ queued: boolean }, unknown>> {
    return this.client.sendPrompt({ conversationId: this.conversationId, prompt });
  }

  queuePrompt(prompt: PromptInput): Promise<Result<{ queued: boolean }, unknown>> {
    return this.client.queuePrompt({ conversationId: this.conversationId, prompt });
  }

  editQueuedPrompt(id: string, input: PromptInput): Promise<Result<void, unknown>> {
    return this.client.editQueuedPrompt({ conversationId: this.conversationId, id, input });
  }

  deleteQueuedPrompt(id: string): Promise<Result<void, unknown>> {
    return this.client.deleteQueuedPrompt({ conversationId: this.conversationId, id });
  }

  changeQueuePromptOrder(ids: string[]): Promise<Result<void, unknown>> {
    return this.client.changeQueuePromptOrder({ conversationId: this.conversationId, ids });
  }

  cancelTurn(): Promise<Result<void, unknown>> {
    return this.client.cancelTurn({ conversationId: this.conversationId });
  }

  setPromptDraft(draft: PromptDraftUpdate): Promise<Result<void, unknown>> {
    return this.client.setPromptDraft({ conversationId: this.conversationId, draft });
  }

  setModelOption(dimension: 'model' | 'effort', value: string): Promise<Result<void, unknown>> {
    return this.client.setModelOption({ conversationId: this.conversationId, dimension, value });
  }

  setModeOption(value: string): Promise<Result<void, unknown>> {
    return this.client.setModeOption({ conversationId: this.conversationId, value });
  }

  resolvePermission(requestId: string, optionId: string): Promise<Result<void, unknown>> {
    return this.client.resolvePermission({
      conversationId: this.conversationId,
      requestId,
      optionId,
    });
  }

  async terminalOutput(terminalId: string): Promise<ReplicaLog> {
    const existing = this.terminalLogs.get(terminalId);
    if (existing) return existing;
    const binding = new ReplicaLog(
      this.client.terminalOutput.handle({ conversationId: this.conversationId, terminalId }),
      {
        store: createMobxLogStore(),
      }
    );
    this.terminalLogs.set(terminalId, binding);
    await binding.ready;
    if (this.disposed) void binding.dispose();
    return binding;
  }

  dispose(): void {
    this.disposed = true;
    void this.sessionState.dispose();
    void this.config.dispose();
    void this.usage.dispose();
    void this.plan.dispose();
    void this.activeTurn.dispose();
    void this.draft.dispose();
    void this.terminals.dispose();
    void this.mcpServers.dispose();
    for (const binding of this.terminalLogs.values()) {
      void binding.dispose();
    }
    this.terminalLogs.clear();
  }
}

async function* singleChunk(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}

function createReplicaState<T>(handle: LiveClientHandle<T>, schema: z.ZodType<T>): ReplicaState<T> {
  return new ReplicaState(handle, {
    schema,
    store: createImmutableMobxStore(),
  });
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
