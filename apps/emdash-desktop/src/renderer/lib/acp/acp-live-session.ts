import {
  planStateSchema,
  promptDraftSchema,
  sessionUsageSchema,
  sessionConfigStateSchema,
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
} from '@emdash/core/acp/client';
import type { Result } from '@emdash/shared';
import type { Unsubscribe } from '@emdash/shared';
import {
  ReplicaLog,
  ReplicaState,
  type LiveClientHandle,
  type LiveLogSnapshotData,
} from '@emdash/wire';
import { z } from 'zod';
import type { LiveLogBinding, LiveBinding } from '@renderer/lib/live/live-bindings';
import {
  getAcpRuntimeClient,
  type AcpRuntimeRpcClient,
  type StartSessionInput,
} from './runtime-client';

export class AcpStartError extends Error {
  constructor(readonly runtimeError: AcpRuntimeError) {
    super(runtimeError.message ?? runtimeError.cause?.message ?? runtimeError.type);
    this.name = 'AcpStartError';
  }

  get errorType(): AcpRuntimeError['type'] {
    return this.runtimeError.type;
  }
}

export class AcpLiveSession {
  readonly sessionState: LiveBinding<SessionState>;
  readonly config: LiveBinding<z.infer<typeof sessionConfigStateSchema>>;
  readonly usage: LiveBinding<z.infer<typeof sessionUsageSchema> | null>;
  readonly plan: LiveBinding<z.infer<typeof planStateSchema> | null>;
  readonly activeTurn: LiveBinding<z.infer<typeof transcriptTurnSchema> | null>;
  readonly draft: LiveBinding<z.infer<typeof promptDraftSchema> | null>;
  readonly terminals: LiveBinding<TerminalState[]>;
  private readonly terminalLogs = new Map<string, LiveLogBinding>();
  private disposed = false;

  private constructor(
    readonly conversationId: string,
    private readonly client: AcpRuntimeRpcClient
  ) {
    const key = { conversationId };
    this.sessionState = new ReplicaStateBinding(
      client.session.state(key, 'state'),
      sessionStateSchema
    );
    this.config = new ReplicaStateBinding(
      client.session.state(key, 'config'),
      sessionConfigStateSchema
    );
    this.usage = new ReplicaStateBinding(
      client.session.state(key, 'usage'),
      sessionUsageSchema.nullable()
    );
    this.plan = new ReplicaStateBinding(client.session.state(key, 'plan'), planStateSchema.nullable());
    this.activeTurn = new ReplicaStateBinding(
      client.session.state(key, 'activeTurn'),
      transcriptTurnSchema.nullable()
    );
    this.draft = new ReplicaStateBinding(
      client.session.state(key, 'draft'),
      promptDraftSchema.nullable()
    );
    this.terminals = new ReplicaStateBinding(
      client.session.state(key, 'terminals'),
      z.array(terminalStateSchema)
    );
  }

  static async create(conversationId: string, input?: StartSessionInput): Promise<AcpLiveSession> {
    const client = await getAcpRuntimeClient();
    if (input) {
      const result = await withTimeout(
        client.startSession({ input }),
        'Timed out starting ACP session'
      );
      if (!result.success) {
        throw new AcpStartError(result.error);
      }
    }
    const session = new AcpLiveSession(conversationId, client);
    await withTimeout(
      Promise.all([
        session.sessionState.start(),
        session.config.start(),
        session.usage.start(),
        session.plan.start(),
        session.activeTurn.start(),
        session.draft.start(),
        session.terminals.start(),
      ]),
      'Timed out connecting ACP live models'
    );
    return session;
  }

  async start(input: StartSessionInput): Promise<Result<{ sessionId: string }, unknown>> {
    return this.client.startSession({ input });
  }

  async resume(
    input: StartSessionInput & { sessionId: string }
  ): Promise<Result<HistoryPage, unknown>> {
    const result = await this.client.resumeSession({ input });
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
    mimeType: AttachmentMimeType;
    name?: string;
    originalPath?: string;
  }): Promise<Result<AttachmentRef, unknown>> {
    return this.client.uploadAttachment(input);
  }

  downloadAttachment(
    id: string
  ): Promise<Result<{ ref: AttachmentRef; data: Uint8Array }, unknown>> {
    return this.client.downloadAttachment({ id });
  }

  deleteAttachment(id: string): Promise<Result<void, unknown>> {
    return this.client.deleteAttachment({ id });
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

  async terminalOutput(terminalId: string): Promise<LiveLogBinding> {
    const existing = this.terminalLogs.get(terminalId);
    if (existing) return existing;
    const binding = new ReplicaLogBinding(this.client.terminalOutput.handle({ terminalId }));
    this.terminalLogs.set(terminalId, binding);
    await binding.start();
    if (this.disposed) binding.dispose();
    return binding;
  }

  dispose(): void {
    this.disposed = true;
    this.sessionState.dispose();
    this.config.dispose();
    this.usage.dispose();
    this.plan.dispose();
    this.activeTurn.dispose();
    this.draft.dispose();
    this.terminals.dispose();
    for (const binding of this.terminalLogs.values()) {
      binding.dispose();
    }
    this.terminalLogs.clear();
  }
}

class ReplicaStateBinding<T> implements LiveBinding<T> {
  private readonly listeners = new Set<() => void>();
  private replica: ReplicaState<T> | null = null;
  private disposed = false;

  constructor(
    private readonly handle: LiveClientHandle<T>,
    private readonly schema: z.ZodType<T>
  ) {}

  async start(): Promise<void> {
    if (this.replica) return;
    const replica = new ReplicaState(this.handle, {
      schema: this.schema,
      onChange: () => this.notify(),
    });
    this.replica = replica;
    await replica.ready;
    if (this.disposed) {
      await replica.dispose();
      return;
    }
    this.notify();
  }

  dispose(): void {
    this.disposed = true;
    const replica = this.replica;
    this.replica = null;
    this.listeners.clear();
    if (replica) void replica.dispose();
  }

  getSnapshot(): T | undefined {
    return this.replica?.current();
  }

  subscribe(cb: () => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

class ReplicaLogBinding implements LiveLogBinding {
  private readonly listeners = new Set<() => void>();
  private replica: ReplicaLog | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private value: LiveLogSnapshotData | undefined;
  private disposed = false;

  constructor(private readonly handle: LiveClientHandle<LiveLogSnapshotData>) {}

  async start(): Promise<void> {
    if (this.replica) return;
    const replica = new ReplicaLog(this.handle);
    this.replica = replica;
    await replica.ready;
    if (this.disposed) {
      await replica.dispose();
      return;
    }
    await this.refresh();
    this.unsubscribe = replica.subscribe(() => {
      void this.refresh();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    const replica = this.replica;
    this.replica = null;
    this.listeners.clear();
    if (replica) void replica.dispose();
  }

  getSnapshot(): LiveLogSnapshotData | undefined {
    return this.value;
  }

  text(): string {
    return this.value?.text ?? this.replica?.text() ?? '';
  }

  subscribe(cb: () => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private async refresh(): Promise<void> {
    const replica = this.replica;
    if (!replica) return;
    this.value = (await replica.snapshot()).data;
    for (const listener of this.listeners) listener();
  }
}

function withTimeout<T>(promise: Promise<T>, message: string, ms = 10_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
