import {
  planStateSchema,
  sessionUsageSchema,
  sessionConfigStateSchema,
  sessionMcpServerSchema,
  sessionStateSchema,
  terminalStateSchema,
  transcriptTurnSchema,
  type AcpRuntimeError,
  type PromptInput,
  type PromptPlacement,
  type SessionState,
  type TerminalState,
} from '@emdash/core/runtimes/acp/api/client';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { createEmitter, type Result, type Unsubscribe } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { TimeoutError, runWithTimeout } from '@emdash/shared/scheduling';
import { ReplicaLog, createLineLogStore } from '@emdash/wire/live';
import { observe, remote, whenReady, type Readable } from '@emdash/wire/state';
import { observable, runInAction } from 'mobx';
import { z } from 'zod';
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
  readonly sessionState: RemoteValueState<SessionState>;
  readonly config: RemoteValueState<z.infer<typeof sessionConfigStateSchema>>;
  readonly usage: RemoteValueState<z.infer<typeof sessionUsageSchema> | null>;
  readonly plan: RemoteValueState<z.infer<typeof planStateSchema> | null>;
  readonly activeTurn: RemoteValueState<z.infer<typeof transcriptTurnSchema> | null>;
  readonly terminals: RemoteValueState<TerminalState[]>;
  readonly mcpServers: RemoteValueState<Array<z.infer<typeof sessionMcpServerSchema>>>;
  private readonly scope = createScope({ label: 'acp-live-session' });
  private readonly terminalLogs = new Map<
    string,
    { replica: ReplicaLog; output: AcpTerminalOutput }
  >();
  private disposed = false;
  private readonly usableState = observable.box(false);
  private validation = 0;
  private readonly refreshStates: () => Promise<void>;

  get usable(): boolean {
    return this.usableState.get();
  }

  private constructor(
    readonly conversationId: string,
    private readonly client: ConversationsClient['acp']
  ) {
    const key = { conversationId };
    const sessionRemote = remote(conversationsContract.acp.session, client.session, {
      scope: this.scope,
      lingerMs: 15_000,
    });
    const member = sessionRemote(key);
    this.refreshStates = async () => {
      await Promise.all(Object.values(member.states).map((state) => state.refresh()));
    };
    this.sessionState = remoteValueState(member.states.state, sessionStateSchema, this.scope);
    this.config = remoteValueState(member.states.config, sessionConfigStateSchema, this.scope);
    this.usage = remoteValueState(member.states.usage, sessionUsageSchema.nullable(), this.scope);
    this.plan = remoteValueState(member.states.plan, planStateSchema.nullable(), this.scope);
    this.activeTurn = remoteValueState(
      member.states.activeTurn,
      transcriptTurnSchema.nullable(),
      this.scope
    );
    this.terminals = remoteValueState(
      member.states.terminals,
      z.array(terminalStateSchema),
      this.scope
    );
    this.mcpServers = remoteValueState(
      member.states.mcpServers,
      z.array(sessionMcpServerSchema),
      this.scope
    );
  }

  static async create(conversationId: string): Promise<AcpLiveSession> {
    const client = (await getConversationsClient()).acp;
    const result = await withTimeout(
      (signal) => client.attach({ conversationId }, { signal }),
      'Timed out attaching ACP session'
    );
    if (!result.success) {
      throw new AcpStartError(result.error);
    }
    const session = new AcpLiveSession(conversationId, client);
    try {
      await withTimeout(
        Promise.all([
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
      runInAction(() => session.usableState.set(true));
      return session;
    } catch (error) {
      session.dispose();
      throw error;
    }
  }

  async revalidate(): Promise<void> {
    const validation = ++this.validation;
    runInAction(() => this.usableState.set(false));
    try {
      const result = await withTimeout(
        (signal) => this.client.attach({ conversationId: this.conversationId }, { signal }),
        'Timed out reattaching ACP session'
      );
      if (validation !== this.validation || this.disposed) return;
      if (!result.success) throw new AcpStartError(result.error);
      await withTimeout(this.refreshStates(), 'Timed out refreshing ACP session');
      if (!this.disposed && validation === this.validation)
        runInAction(() => this.usableState.set(true));
    } catch (error) {
      if (!this.disposed && validation === this.validation) throw error;
    }
  }

  loadHistory(before?: number, limit = 50) {
    return this.client.loadHistory({ conversationId: this.conversationId, before, limit });
  }

  async exportTranscript(): Promise<Result<string, unknown>> {
    const result = await this.client.exportAcpTranscript({
      conversationId: this.conversationId,
    });
    if (!result.success) return result;
    return { success: true, data: result.data.transcript };
  }

  async exportRawAcpLog(): Promise<Result<string, unknown>> {
    const result = await this.client.exportRawAcpLog({ conversationId: this.conversationId });
    if (!result.success) return result;
    return { success: true, data: result.data.log };
  }

  sendPrompt(
    prompt: PromptInput,
    placement?: PromptPlacement
  ): Promise<Result<{ queued: boolean }, unknown>> {
    return this.client.sendPrompt(
      { conversationId: this.conversationId, prompt, placement },
      { timeoutMs: 0 }
    );
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

  setOption(
    key: 'model' | 'mode' | 'effort' | 'collaborationMode',
    value: string
  ): Promise<Result<void, unknown>> {
    return this.client.setOption({ conversationId: this.conversationId, key, value });
  }

  resolvePermission(requestId: string, optionId: string): Promise<Result<void, unknown>> {
    return this.client.resolvePermission({
      conversationId: this.conversationId,
      requestId,
      optionId,
    });
  }

  async terminalOutput(terminalId: string): Promise<AcpTerminalOutput> {
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
    if (this.disposed) void replica.dispose();
    return output;
  }

  dispose(): void {
    this.disposed = true;
    this.validation += 1;
    runInAction(() => this.usableState.set(false));
    void this.scope.dispose();
    for (const { replica } of this.terminalLogs.values()) {
      void replica.dispose();
    }
    this.terminalLogs.clear();
  }
}

export function remoteValueState<T>(
  source: Readable<T | undefined>,
  schema: z.ZodType<T>,
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
    if (settled.value !== undefined) update(schema.parse(settled.value));
  });
  observe(
    source,
    (snapshot) => {
      if (snapshot.value !== undefined) {
        const next = schema.parse(snapshot.value);
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
