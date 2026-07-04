import { z } from 'zod';
import {
  agentStateSchema,
  planStateSchema,
  sessionConfigStateSchema,
  sessionStateSchema,
  terminalStateSchema,
  transcriptTurnSchema,
  type HistoryPage,
  type PromptInput,
  type SessionState,
  type TerminalState,
} from '@emdash/core/acp/client';
import type { Result } from '@emdash/shared';
import type { LiveLogBinding, LiveBinding } from '@renderer/lib/live/live-bindings';
import { createLiveLogBinding, createLiveModelBinding } from '@renderer/lib/live/live-bindings';
import { getAcpRuntimeClient, type AcpRuntimeRpcClient, type StartSessionInput } from './runtime-client';

export class AcpLiveSession {
  readonly sessionState: LiveBinding<SessionState>;
  readonly config: LiveBinding<z.infer<typeof sessionConfigStateSchema>>;
  readonly plan: LiveBinding<z.infer<typeof planStateSchema> | null>;
  readonly agents: LiveBinding<Array<z.infer<typeof agentStateSchema>>>;
  readonly activeTurn: LiveBinding<z.infer<typeof transcriptTurnSchema> | null>;
  readonly terminals: LiveBinding<TerminalState[]>;
  private readonly terminalLogs = new Map<string, LiveLogBinding>();
  private disposed = false;

  private constructor(
    readonly conversationId: string,
    private readonly client: AcpRuntimeRpcClient
  ) {
    this.sessionState = createLiveModelBinding({
      schema: sessionStateSchema,
      snapshot: () => client.live.sessionState.snapshot({ conversationId }),
      subscribe: () => client.live.sessionState.subscribe({ conversationId }),
    });
    this.config = createLiveModelBinding({
      schema: sessionConfigStateSchema,
      snapshot: () => client.live.sessionConfig.snapshot({ conversationId }),
      subscribe: () => client.live.sessionConfig.subscribe({ conversationId }),
    });
    this.plan = createLiveModelBinding({
      schema: planStateSchema.nullable(),
      snapshot: () => client.live.plan.snapshot({ conversationId }),
      subscribe: () => client.live.plan.subscribe({ conversationId }),
    });
    this.agents = createLiveModelBinding({
      schema: z.array(agentStateSchema),
      snapshot: () => client.live.agents.snapshot({ conversationId }),
      subscribe: () => client.live.agents.subscribe({ conversationId }),
    });
    this.activeTurn = createLiveModelBinding({
      schema: transcriptTurnSchema.nullable(),
      snapshot: () => client.live.activeTurn.snapshot({ conversationId }),
      subscribe: () => client.live.activeTurn.subscribe({ conversationId }),
    });
    this.terminals = createLiveModelBinding({
      schema: z.array(terminalStateSchema),
      snapshot: () => client.live.terminals.snapshot({ conversationId }),
      subscribe: () => client.live.terminals.subscribe({ conversationId }),
    });
  }

  static async create(conversationId: string, input?: StartSessionInput): Promise<AcpLiveSession> {
    const client = await getAcpRuntimeClient();
    if (input) {
      const result = await withTimeout(
        client.startSession({ input }),
        'Timed out starting ACP session'
      );
      if (!result.success) {
        throw new Error(result.error.message ?? result.error.type);
      }
    }
    const session = new AcpLiveSession(conversationId, client);
    await withTimeout(
      Promise.all([
        session.sessionState.start(),
        session.config.start(),
        session.plan.start(),
        session.agents.start(),
        session.activeTurn.start(),
        session.terminals.start(),
      ]),
      'Timed out connecting ACP live models'
    );
    return session;
  }

  async start(input: StartSessionInput): Promise<Result<{ sessionId: string }, unknown>> {
    return this.client.startSession({ input });
  }

  async resume(input: StartSessionInput & { sessionId: string }): Promise<Result<HistoryPage, unknown>> {
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

  sendPrompt(prompt: PromptInput): Promise<Result<{ queued: boolean }, unknown>> {
    return this.client.sendPrompt({ conversationId: this.conversationId, prompt });
  }

  cancelTurn(): Promise<Result<void, unknown>> {
    return this.client.cancelTurn({ conversationId: this.conversationId });
  }

  setModelOption(dimension: 'model' | 'effort', value: string): Promise<Result<void, unknown>> {
    return this.client.setModelOption({ conversationId: this.conversationId, dimension, value });
  }

  setModeOption(value: string): Promise<Result<void, unknown>> {
    return this.client.setModeOption({ conversationId: this.conversationId, value });
  }

  resolvePermission(requestId: string, optionId: string): Promise<Result<void, unknown>> {
    return this.client.resolvePermission({ conversationId: this.conversationId, requestId, optionId });
  }

  async terminalOutput(terminalId: string): Promise<LiveLogBinding> {
    const existing = this.terminalLogs.get(terminalId);
    if (existing) return existing;
    const binding = createLiveLogBinding({
      snapshot: () => this.client.live.terminalOutput.snapshot({ terminalId }),
      subscribe: () => this.client.live.terminalOutput.subscribe({ terminalId }),
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
    this.plan.dispose();
    this.agents.dispose();
    this.activeTurn.dispose();
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
