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
import { z } from 'zod';
import type { LiveLogBinding, LiveBinding } from '@renderer/lib/live/live-bindings';
import { createLiveLogBinding, createLiveModelBinding } from '@renderer/lib/live/live-bindings';
import {
  getAcpRuntimeClient,
  getAcpRuntimeLive,
  type AcpRuntimeLiveClient,
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
    private readonly client: AcpRuntimeRpcClient,
    private readonly live: AcpRuntimeLiveClient
  ) {
    this.sessionState = createLiveModelBinding({
      schema: sessionStateSchema,
      snapshot: () => live.sessionState.snapshot({ conversationId }),
      attach: (push) => live.sessionState.attach({ conversationId }, push),
    });
    this.config = createLiveModelBinding({
      schema: sessionConfigStateSchema,
      snapshot: () => live.sessionConfig.snapshot({ conversationId }),
      attach: (push) => live.sessionConfig.attach({ conversationId }, push),
    });
    this.usage = createLiveModelBinding({
      schema: sessionUsageSchema.nullable(),
      snapshot: () => live.sessionUsage.snapshot({ conversationId }),
      attach: (push) => live.sessionUsage.attach({ conversationId }, push),
    });
    this.plan = createLiveModelBinding({
      schema: planStateSchema.nullable(),
      snapshot: () => live.plan.snapshot({ conversationId }),
      attach: (push) => live.plan.attach({ conversationId }, push),
    });
    this.activeTurn = createLiveModelBinding({
      schema: transcriptTurnSchema.nullable(),
      snapshot: () => live.activeTurn.snapshot({ conversationId }),
      attach: (push) => live.activeTurn.attach({ conversationId }, push),
    });
    this.draft = createLiveModelBinding({
      schema: promptDraftSchema.nullable(),
      snapshot: () => live.promptDraft.snapshot({ conversationId }),
      attach: (push) => live.promptDraft.attach({ conversationId }, push),
    });
    this.terminals = createLiveModelBinding({
      schema: z.array(terminalStateSchema),
      snapshot: () => live.terminals.snapshot({ conversationId }),
      attach: (push) => live.terminals.attach({ conversationId }, push),
    });
  }

  static async create(conversationId: string, input?: StartSessionInput): Promise<AcpLiveSession> {
    const client = await getAcpRuntimeClient();
    const live = getAcpRuntimeLive();
    if (input) {
      const result = await withTimeout(
        client.startSession({ input }),
        'Timed out starting ACP session'
      );
      if (!result.success) {
        throw new AcpStartError(result.error);
      }
    }
    const session = new AcpLiveSession(conversationId, client, live);
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
    const binding = createLiveLogBinding({
      snapshot: () => this.live.terminalOutput.snapshot({ terminalId }),
      attach: (push) => this.live.terminalOutput.attach({ terminalId }, push),
    });
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
